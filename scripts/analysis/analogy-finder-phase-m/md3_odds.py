"""BOA-271 Phase M — MD-3 オッズを材料にするかの検証

期間: 2026-04-01〜2026-09-30（時系列オッズは遡れない）。オッズが取れたレースに限る。
時点: 直前情報時点（締切10分前）に最も近い締切前のスナップショット。
      締切前10〜60分の範囲で、締切に最も近いもの。締切後・締切時オッズ（odds_final）は使わない。
特徴量: 単勝オッズ → 1/odds をレース内で正規化した暗黙の確率（mkt_p）、その対数、レース内順位。
比較: 同じ期間・同じ分割（拡張窓3分割）でオッズ込み／抜きの LightGBM（主モデルと同じ特徴量・
      ハイパーパラメータ）。1着艇の6クラス対数損失・Brier・10分位キャリブレーション、
      レース単位ペア差のブートストラップ95%CI。
判定（事前固定、spec MD-3）:
  採る = 込みモデルの対数損失がペア差 CI で有意に良く（上限<0）、かつ他テーマのシェア順位が大きく崩れない
  「大きく崩れない」の定義（本スクリプトで事前固定）: 市場を除く6テーマのシェア順位で
      Kendall τ ≥ 0.6、かつ上位3テーマの集合が変わらない
  有意に良いが崩れる場合 = 「モデルには入れ、FR-1 では市場を別枠表示」案
  有意でない場合 = 材料にしない
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.stats import kendalltau

import common as C
from build_dataset import read

SPLITS = [("S1", "2026-04-01", "2026-06-30", "2026-07-01", "2026-07-31"),
          ("S2", "2026-04-01", "2026-07-31", "2026-08-01", "2026-08-31"),
          ("S3", "2026-04-01", "2026-08-31", "2026-09-01", "2026-09-30")]
ODDS_FEATS = ["mkt_p", "mkt_logp", "mkt_rank"]
THEMES_MKT = {**C.THEMES, "市場": ODDS_FEATS}
import os

# 既定は締切10〜60分前。感度分析として ASOF_MIN=5 でも回す（単勝6艇がそろうスナップショットが少ないため）
ASOF_MIN, ASOF_MAX = float(os.environ.get("ASOF_MIN", "10")), 60.0
SUFFIX = "" if ASOF_MIN == 10 else f"_asof{int(ASOF_MIN)}"


def load_odds(races: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    o = read("odds")
    r = races[["race_id", "race_date", "start_time"]].drop_duplicates("race_id")
    o = o.merge(r, on="race_id", how="inner")
    deadline = pd.to_datetime(o["race_date"].astype(str) + " " + o["start_time"].astype(str)) \
        .dt.tz_localize("Asia/Tokyo")
    cap = pd.to_datetime(o["captured_at"], utc=True, format="ISO8601")
    o["mins_before"] = (deadline - cap).dt.total_seconds() / 60
    oc = [f"odds_win_{b}" for b in range(1, 7)]
    valid = (o[oc] > 0).all(axis=1)
    all_dist = o["mins_before"].describe(percentiles=[.05, .25, .5, .75, .95]).to_dict()
    cand = o[valid & (o["mins_before"] >= ASOF_MIN) & (o["mins_before"] <= ASOF_MAX)]
    pick = cand.sort_values("mins_before").drop_duplicates("race_id")
    dist = pick["mins_before"].describe(percentiles=[.05, .25, .5, .75, .95]).to_dict()
    hist = pd.cut(pick["mins_before"], [10, 12, 15, 20, 30, 45, 60], include_lowest=True) \
        .value_counts().sort_index()
    long = pick.melt(id_vars=["race_id", "mins_before", "source"], value_vars=oc,
                     var_name="b", value_name="odds")
    long["boat_number"] = long["b"].str[-1].astype(int)
    inv = 1 / long["odds"]
    long["mkt_p"] = inv / inv.groupby(long["race_id"]).transform("sum")
    long["mkt_logp"] = np.log(long["mkt_p"])
    long["mkt_rank"] = long.groupby("race_id")["mkt_p"].rank(ascending=False, method="min")
    info = {
        "snapshots_all_mins_before": {k: float(v) for k, v in all_dist.items()},
        "picked_mins_before": {k: float(v) for k, v in dist.items()},
        "picked_hist": {str(k): int(v) for k, v in hist.items()},
        "picked_by_source": pick["source"].value_counts().to_dict(),
        "n_races_with_any_snapshot": int(o["race_id"].nunique()),
        "n_races_picked": int(len(pick)),
        "asof_window_min": [ASOF_MIN, ASOF_MAX],
        "share_snapshots_all6_valid": float(valid.mean()),
    }
    return long[["race_id", "boat_number", "mins_before"] + ODDS_FEATS], info


def kendall_rank_check(sh_without: dict, sh_with: dict):
    themes = list(C.THEMES)
    a = [sh_without[t] for t in themes]
    # 込みモデルは市場を除いて正規化し直したシェアで順位を比べる
    tot = sum(sh_with[t] for t in themes)
    b = [sh_with[t] / tot for t in themes]
    tau = float(kendalltau(a, b).statistic)
    top3_a = set(sorted(themes, key=lambda t: -sh_without[t])[:3])
    top3_b = set(sorted(themes, key=lambda t: -sh_with[t])[:3])
    return {"kendall_tau": tau, "top3_without": sorted(top3_a), "top3_with": sorted(top3_b),
            "top3_same": top3_a == top3_b, "renormalized_with_excl_market": dict(zip(themes, b)),
            "stable": bool(tau >= 0.6 and top3_a == top3_b)}


def main():
    df = pd.read_pickle(C.D / "boats.pkl")
    df = C.complete_races(df)
    races = read("races")
    df = df[(df["race_date"] >= "2026-04-01") & (df["race_date"] <= "2026-09-30")]
    n_all = df["race_id"].nunique()
    odds, oinfo = load_odds(races)
    df = df.merge(odds, on=["race_id", "boat_number"], how="inner")
    df = df[df.groupby("race_id")["boat_number"].transform("size") == 6]
    df = df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    oinfo["n_races_complete_in_period"] = int(n_all)
    oinfo["n_races_used"] = int(df["race_id"].nunique())
    print(json.dumps(oinfo, ensure_ascii=False, indent=1))

    main_res = json.loads((C.D / "main_result.json").read_text())
    params = main_res["tuning"]["best"]
    f0 = C.BASE_FEATURES
    f1 = C.BASE_FEATURES + ODDS_FEATS

    out = {"odds_info": oinfo, "params": params, "splits": []}
    pooled = {"ll0": [], "ll1": [], "llm": [], "llb": [], "br0": [], "br1": [], "brm": [],
              "day": [], "p0": [], "p1": [], "y": []}
    contribs = {"without": [], "with": []}
    for name, a, b, c, d in SPLITS:
        tr = df[(df["race_date"] >= a) & (df["race_date"] <= b)]
        te = df[(df["race_date"] >= c) & (df["race_date"] <= d)]
        cut = tr["race_date"].max() - pd.Timedelta(days=21)
        tr_in, es = tr[tr["race_date"] <= cut], tr[tr["race_date"] > cut]
        y_te, y_es = C.winner_index(te), C.winner_index(es)
        res = {"split": name, "train": [a, b], "test": [c, d],
               "n_train_races": int(tr["race_id"].nunique()), "n_test_races": int(te["race_id"].nunique())}
        ps = {}
        for key, feats in (("without", f0), ("with", f1)):
            m = C.fit_lgb(tr_in, es, feats, "y_win", params)
            t = C.fit_temperature(C.raw_score(m, es, feats).reshape(-1, 6), y_es)
            p = C.softmax_rows(C.raw_score(m, te, feats).reshape(-1, 6), t)
            p_tr = C.softmax_rows(C.raw_score(m, tr_in, feats).reshape(-1, 6), t)
            ps[key] = p
            res[key] = {"best_iteration": int(m.best_iteration), "temperature": t,
                        "logloss": float(C.per_race_logloss(p, y_te).mean()),
                        "logloss_train": float(C.per_race_logloss(p_tr, C.winner_index(tr_in)).mean()),
                        "brier": float(C.per_race_brier(p, y_te).mean())}
            contribs[key].append((m.predict(te[feats].astype(float), num_iteration=m.best_iteration,
                                            pred_contrib=True), feats))
        pm = te["mkt_p"].to_numpy().reshape(-1, 6)
        pb = C.baseline_winner(tr, te)
        res["market_only"] = {"logloss": float(C.per_race_logloss(pm, y_te).mean()),
                              "brier": float(C.per_race_brier(pm, y_te).mean())}
        res["baseline1"] = {"logloss": float(C.per_race_logloss(pb, y_te).mean()),
                            "brier": float(C.per_race_brier(pb, y_te).mean())}
        l0, l1 = C.per_race_logloss(ps["without"], y_te), C.per_race_logloss(ps["with"], y_te)
        res["paired_logloss_with_minus_without"] = C.paired_ci(l1 - l0)
        print(name, {k: res[k]["logloss"] for k in ("without", "with", "market_only", "baseline1")},
              res["paired_logloss_with_minus_without"]["ci95"])
        out["splits"].append(res)
        pooled["ll0"].append(l0); pooled["ll1"].append(l1)
        pooled["llm"].append(C.per_race_logloss(pm, y_te)); pooled["llb"].append(C.per_race_logloss(pb, y_te))
        pooled["br0"].append(C.per_race_brier(ps["without"], y_te))
        pooled["br1"].append(C.per_race_brier(ps["with"], y_te))
        pooled["brm"].append(C.per_race_brier(pm, y_te))
        pooled["day"].append(te[te["boat_number"] == 1]["race_date"].to_numpy())
        pooled["p0"].append(ps["without"].ravel()); pooled["p1"].append(ps["with"].ravel())
        pooled["y"].append(te["y_win"].to_numpy())
    P = {k: np.concatenate(v) for k, v in pooled.items()}
    out["pooled"] = {
        "n_test_races": int(len(P["ll0"])),
        "logloss": {"without": float(P["ll0"].mean()), "with": float(P["ll1"].mean()),
                    "market_only": float(P["llm"].mean()), "baseline1": float(P["llb"].mean())},
        "brier": {"without": float(P["br0"].mean()), "with": float(P["br1"].mean()),
                  "market_only": float(P["brm"].mean())},
        "paired_logloss_with_minus_without": C.paired_ci(P["ll1"] - P["ll0"], clusters=P["day"]),
        "paired_brier_with_minus_without": C.paired_ci(P["br1"] - P["br0"], clusters=P["day"]),
        "paired_logloss_with_minus_market_only": C.paired_ci(P["ll1"] - P["llm"], clusters=P["day"]),
        "paired_logloss_without_minus_baseline1": C.paired_ci(P["ll0"] - P["llb"], clusters=P["day"]),
        "calibration_without": C.calibration_deciles(P["p0"], P["y"]),
        "calibration_with": C.calibration_deciles(P["p1"], P["y"]),
    }
    shares = {}
    for key, themes in (("without", C.THEMES), ("with", THEMES_MKT)):
        cs = np.vstack([c for c, _ in contribs[key]])
        feats = contribs[key][0][1]
        sh, fsh, n = C.theme_shares(cs, feats, themes=themes)
        shares[key] = {"shares": sh, "n_boats": n,
                       "top_features": dict(sorted(fsh.items(), key=lambda x: -x[1])[:12])}
    out["shap"] = shares
    out["rank_check"] = kendall_rank_check(shares["without"]["shares"], shares["with"]["shares"])
    ci = out["pooled"]["paired_logloss_with_minus_without"]["ci95"]
    sig = ci[1] < 0
    if sig and out["rank_check"]["stable"]:
        verdict = "採る（有意に良く、他テーマの順位も崩れない）"
    elif sig:
        verdict = "有意に良いが他テーマの順位が崩れる → モデルには入れ、FR-1 では市場を別枠表示する案をモックで確認"
    else:
        verdict = "材料にしない（有意な改善なし）"
    out["verdict"] = verdict
    print(verdict, ci, out["rank_check"])
    (C.D / f"md3_result{SUFFIX}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
