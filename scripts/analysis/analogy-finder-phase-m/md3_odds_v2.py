"""BOA-271 Phase M — MD-3 再実行（v2）: 単勝オッズの欠損を「票0」として扱う

前回（md3_odds.py）との違い:
  - race_odds の odds_win_N が null（または 0）なのは、取得時点でその艇の単勝の票が0（公式表示「0.0」）
    だったため。前回は「6艇そろうスナップショット」だけを使い、使えるレースが 8,117R に減り、
    選び方にも偏り（票が多い＝人気が分散したレース・締切に近い時点）があった
  - v2 は 6艇そろうことを条件にしない。締切10〜60分前で締切に最も近いスナップショットを使い、
    行自体が無いレースだけ除く
時点: 締切10〜60分前（前回と同じ）。締切時オッズ（race_odds_final）は特徴量に使わない
特徴量（テーマ「市場」）:
  mkt_p     票のある艇の 1/odds をレース内で正規化。票0の艇は ε（ε を足して正規化し直す）
  mkt_logp  log(mkt_p)
  mkt_rank  mkt_p のレース内順位（票0は同順位で最下位）
  mkt_zero  その艇が票0か
  mkt_nzero レース内の票0の艇の数
  mkt_mins  取得時刻（締切何分前か）
比較 A（判定に使う。前回と同じ設計）: 2026-04〜09 の時系列3分割で LightGBM を一から学習し、
      オッズ込み／抜きを同じレース・同じ分割で比べる。SHAP のテーマシェアもこちら
比較 B（頑健性の確認）: F5 主モデルの1着スコア z＋艇番の切片を土台にした条件付きロジットで、
      オッズの特徴量を足したときの上積み（日ブロック5分割 CV、MD-4 と同じ方式）
判定（事前固定、spec MD-3。前回と同じ）: A の込み−抜き LL ペア差 CI 上限<0、かつ市場を除いた
      6テーマのシェア順位で Kendall τ≥0.6 かつ上位3テーマの集合が同じ → 採る。
      有意だが崩れる → モデルに入れて FR-1 では市場を別枠表示の案。有意でない → 材料にしない
環境変数: ASOF_MIN（既定 10。0 にすると「締切0〜60分前」の参考＝判定外の天井）、
          SKIP_EPS（1 で ε の感度を省く。参考の天井を回すとき用）
"""

from __future__ import annotations

import json
import os

import lightgbm as lgb
import numpy as np
import pandas as pd

import common as C
from build_dataset import read
from md3_odds import SPLITS, kendall_rank_check
from md4_items import BOAT_DUMMIES, clogit_fit, clogit_pred

ASOF_MIN, ASOF_MAX = float(os.environ.get("ASOF_MIN", "10")), 60.0
SUFFIX = "" if ASOF_MIN == 10 else f"_asof{int(ASOF_MIN)}"
EPS_MAIN = 1e-3
EPS_GRID = [1e-4, 1e-3, 3e-3, 1e-2, 3e-2]
ODDS_FEATS = ["mkt_p", "mkt_logp", "mkt_rank", "mkt_zero", "mkt_nzero", "mkt_mins"]
THEMES_MKT = {**C.THEMES, "市場": ODDS_FEATS}
OC = [f"odds_win_{b}" for b in range(1, 7)]


def pick_snapshots(races: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    o = read("odds")
    r = races[["race_id", "race_date", "start_time"]].drop_duplicates("race_id")
    o = o.merge(r, on="race_id", how="inner")
    deadline = pd.to_datetime(o["race_date"].astype(str) + " " + o["start_time"].astype(str)) \
        .dt.tz_localize("Asia/Tokyo")
    cap = pd.to_datetime(o["captured_at"], utc=True, format="ISO8601")
    o["mins_before"] = (deadline - cap).dt.total_seconds() / 60
    cand = o[(o["mins_before"] >= ASOF_MIN) & (o["mins_before"] <= ASOF_MAX)]
    pick = cand.sort_values("mins_before").drop_duplicates("race_id").reset_index(drop=True)
    v = pick[OC].to_numpy(dtype=float)
    zero = ~(np.nan_to_num(v) > 0)
    nz = zero.sum(axis=1)
    edges = [0, 5, 10, 12, 15, 20, 30, 45, 60]
    hist = pd.cut(pick["mins_before"], [e for e in edges if e >= ASOF_MIN], include_lowest=True) \
        .value_counts().sort_index()
    q = [.05, .25, .5, .75, .95]
    info = {
        "asof_window_min": [ASOF_MIN, ASOF_MAX],
        "n_races_with_any_snapshot": int(o["race_id"].nunique()),
        "n_races_picked": int(len(pick)),
        "picked_mins_before": {k: float(x) for k, x in pick["mins_before"].describe(percentiles=q).items()},
        "picked_hist": {str(k): int(x) for k, x in hist.items()},
        "picked_by_source": pick["source"].value_counts().to_dict(),
        "picked_share_races_with_any_zero_boat": float((nz > 0).mean()),
        "picked_n_zero_dist": {int(k): int(x) for k, x in pd.Series(nz).value_counts().sort_index().items()},
        "picked_zero_rate_by_boat": {b + 1: float(zero[:, b].mean()) for b in range(6)},
        "picked_all6_zero_races": int((nz == 6).sum()),
        "share_snapshots_all6_voted_all": float((~(~(np.nan_to_num(o[OC].to_numpy(float)) > 0))).all(1).mean()),
    }
    return pick, info


def market_long(pick: pd.DataFrame, eps: float) -> pd.DataFrame:
    """票0の艇は ε。票のある艇の暗黙確率（合計1に正規化）に ε を足して正規化し直す。
    6艇とも票0のスナップショットは一様（1/6）。"""
    v = pick[OC].to_numpy(dtype=float)
    voted = np.nan_to_num(v) > 0
    inv = np.where(voted, 1 / np.where(voted, v, 1), 0.0)
    s = inv.sum(axis=1, keepdims=True)
    q = np.where(s > 0, inv / np.where(s > 0, s, 1), 1 / 6)
    q = np.where(voted | (s == 0), q, eps)
    p = q / q.sum(axis=1, keepdims=True)
    nz = (~voted).sum(axis=1)
    rank = pd.DataFrame(-p).rank(axis=1, method="min").to_numpy()
    n = len(pick)
    return pd.DataFrame({
        "race_id": np.repeat(pick["race_id"].to_numpy(), 6),
        "boat_number": np.tile(np.arange(1, 7), n),
        "mkt_p": p.ravel(), "mkt_logp": np.log(p).ravel(), "mkt_rank": rank.ravel(),
        "mkt_zero": (~voted).astype(float).ravel(), "mkt_nzero": np.repeat(nz, 6).astype(float),
        "mkt_mins": np.repeat(pick["mins_before"].to_numpy(), 6),
    })


def run_lgb(df: pd.DataFrame, params: dict, with_shap=True):
    f0, f1 = C.BASE_FEATURES, C.BASE_FEATURES + ODDS_FEATS
    pooled = {k: [] for k in ("ll0", "ll1", "llm", "llb", "br0", "br1", "brm", "brb", "day", "p0", "p1", "y")}
    contribs = {"without": [], "with": []}
    splits = []
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
            if with_shap:
                contribs[key].append((m.predict(te[feats].astype(float), num_iteration=m.best_iteration,
                                                pred_contrib=True), feats))
        pm = te["mkt_p"].to_numpy().reshape(-1, 6)
        pb = C.baseline_winner(tr, te)
        l0, l1 = C.per_race_logloss(ps["without"], y_te), C.per_race_logloss(ps["with"], y_te)
        lm, lb = C.per_race_logloss(pm, y_te), C.per_race_logloss(pb, y_te)
        res["market_only"] = {"logloss": float(lm.mean()), "brier": float(C.per_race_brier(pm, y_te).mean())}
        res["baseline1"] = {"logloss": float(lb.mean()), "brier": float(C.per_race_brier(pb, y_te).mean())}
        res["paired_logloss_with_minus_without"] = C.paired_ci(l1 - l0)
        splits.append(res)
        print(name, res["n_train_races"], res["n_test_races"],
              {k: round(res[k]["logloss"], 4) for k in ("without", "with", "market_only", "baseline1")},
              res["paired_logloss_with_minus_without"]["ci95"], flush=True)
        pooled["ll0"].append(l0); pooled["ll1"].append(l1); pooled["llm"].append(lm); pooled["llb"].append(lb)
        pooled["br0"].append(C.per_race_brier(ps["without"], y_te))
        pooled["br1"].append(C.per_race_brier(ps["with"], y_te))
        pooled["brm"].append(C.per_race_brier(pm, y_te)); pooled["brb"].append(C.per_race_brier(pb, y_te))
        pooled["day"].append(te[te["boat_number"] == 1]["race_date"].to_numpy())
        pooled["p0"].append(ps["without"].ravel()); pooled["p1"].append(ps["with"].ravel())
        pooled["y"].append(te["y_win"].to_numpy())
    P = {k: np.concatenate(v) for k, v in pooled.items()}
    d = P["ll1"] - P["ll0"]
    out = {
        "splits": splits,
        "n_test_races": int(len(P["ll0"])),
        "logloss": {"without": float(P["ll0"].mean()), "with": float(P["ll1"].mean()),
                    "market_only": float(P["llm"].mean()), "baseline1": float(P["llb"].mean())},
        "brier": {"without": float(P["br0"].mean()), "with": float(P["br1"].mean()),
                  "market_only": float(P["brm"].mean()), "baseline1": float(P["brb"].mean())},
        "paired_logloss_with_minus_without": C.paired_ci(d, clusters=P["day"]),
        "paired_brier_with_minus_without": C.paired_ci(P["br1"] - P["br0"], clusters=P["day"]),
        "paired_logloss_with_minus_market_only": C.paired_ci(P["ll1"] - P["llm"], clusters=P["day"]),
        "paired_logloss_without_minus_baseline1": C.paired_ci(P["ll0"] - P["llb"], clusters=P["day"]),
        "sd_per_race_diff": float(d.std(ddof=1)),
        "calibration_without": C.calibration_deciles(P["p0"], P["y"]),
        "calibration_with": C.calibration_deciles(P["p1"], P["y"]),
    }
    if with_shap:
        shares = {}
        for key, themes in (("without", C.THEMES), ("with", THEMES_MKT)):
            cs = np.vstack([c for c, _ in contribs[key]])
            feats = contribs[key][0][1]
            sh, fsh, n = C.theme_shares(cs, feats, themes=themes)
            shares[key] = {"shares": sh, "n_boats": n,
                           "top_features": dict(sorted(fsh.items(), key=lambda x: -x[1])[:12]),
                           "market_features": {f: fsh[f] for f in ODDS_FEATS} if key == "with" else None}
        out["shap"] = shares
        out["rank_check"] = kendall_rank_check(shares["without"]["shares"], shares["with"]["shares"])
    return out


def run_clogit(df: pd.DataFrame, n_blocks=5):
    """F5 スコア z＋艇番の切片（抜き）と、それに市場の特徴量を足したもの（込み）。日ブロック CV。"""
    sub = df.sort_values(["race_date", "race_id", "boat_number"])
    z = sub["z"].to_numpy().reshape(-1, 6)
    y = C.winner_index(sub)
    mins = sub["mkt_mins"].to_numpy()
    feats = np.stack([sub["mkt_logp"].to_numpy(), sub["mkt_zero"].to_numpy(),
                      sub["mkt_logp"].to_numpy() * sub["mkt_nzero"].to_numpy(),
                      sub["mkt_logp"].to_numpy() * mins], axis=1).reshape(-1, 6, 4)
    days = sub[sub["boat_number"] == 1]["race_date"].to_numpy()
    blocks = np.array_split(np.unique(days), n_blocks)
    p0 = np.zeros_like(z); p1 = np.zeros_like(z); pm = np.zeros_like(z)
    Xb = BOAT_DUMMIES[None].repeat(len(z), 0)
    for blk in blocks:
        te = np.isin(days, blk); tr = ~te
        X = feats.copy()
        mu = X[tr].reshape(-1, 4).mean(0); sd = X[tr].reshape(-1, 4).std(0); sd[sd == 0] = 1
        X = (X - mu) / sd
        X1 = np.concatenate([Xb, X], axis=2)
        w0 = clogit_fit(z[tr], Xb[tr], y[tr])
        w1 = clogit_fit(z[tr], X1[tr], y[tr])
        # 市場のみ（z を使わない）: u = a·logp + 艇番の切片。z の代わりに logp を土台に置く
        lp = sub["mkt_logp"].to_numpy().reshape(-1, 6)
        wm = clogit_fit(lp[tr], Xb[tr], y[tr])
        p0[te] = clogit_pred(w0, z[te], Xb[te]); p1[te] = clogit_pred(w1, z[te], X1[te])
        pm[te] = clogit_pred(wm, lp[te], Xb[te])
    l0, l1, lm = (C.per_race_logloss(p, y) for p in (p0, p1, pm))
    return {
        "n_races": int(len(y)), "features": ["logp", "zero", "logp×nzero", "logp×mins"],
        "logloss": {"without": float(l0.mean()), "with": float(l1.mean()), "market_only_recal": float(lm.mean())},
        "brier": {"without": float(C.per_race_brier(p0, y).mean()), "with": float(C.per_race_brier(p1, y).mean()),
                  "market_only_recal": float(C.per_race_brier(pm, y).mean())},
        "paired_logloss_with_minus_without": C.paired_ci(l1 - l0, clusters=days),
        "paired_brier_with_minus_without": C.paired_ci(C.per_race_brier(p1, y) - C.per_race_brier(p0, y),
                                                       clusters=days),
        "sd_per_race_diff": float((l1 - l0).std(ddof=1)),
        "calibration_without": C.calibration_deciles(p0.ravel(), sub["y_win"].to_numpy()),
        "calibration_with": C.calibration_deciles(p1.ravel(), sub["y_win"].to_numpy()),
    }


def zero_boat_win_stats(df: pd.DataFrame) -> dict:
    """票0の艇が1着になった割合（市場のみの LL が ε に強く依存する理由の説明用）。"""
    z = df[df["mkt_zero"] == 1]
    w = df[df["y_win"] == 1]
    return {"n_zero_boats": int(len(z)), "win_rate_of_zero_boats": float(z["y_win"].mean()) if len(z) else None,
            "share_races_won_by_zero_boat": float((w["mkt_zero"] == 1).mean()),
            "win_rate_of_zero_boats_by_boat": z.groupby("boat_number")["y_win"].mean().round(4).to_dict()}


def main():
    base = pd.read_pickle(C.D / "boats.pkl")
    base = C.complete_races(base)
    races = read("races")
    base = base[(base["race_date"] >= "2026-04-01") & (base["race_date"] <= "2026-09-30")]
    n_all = base["race_id"].nunique()
    pick, info = pick_snapshots(races)
    info["n_races_complete_in_period"] = int(n_all)
    params = json.loads((C.D / "main_result.json").read_text())["tuning"]["best"]
    m5 = lgb.Booster(model_file=str(C.D / "main_win_F5.txt"))
    base = base.copy()
    base["z"] = m5.predict(base[C.BASE_FEATURES].astype(float), raw_score=True)

    def assemble(eps):
        d = base.merge(market_long(pick, eps), on=["race_id", "boat_number"], how="inner")
        d = d[d.groupby("race_id")["boat_number"].transform("size") == 6]
        return d.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)

    df = assemble(EPS_MAIN)
    info["n_races_used"] = int(df["race_id"].nunique())
    used = df[df["boat_number"] == 1]
    info["used_mins_before"] = {k: float(x) for k, x in
                                used["mkt_mins"].describe(percentiles=[.05, .25, .5, .75, .95]).items()}
    info["used_share_races_with_any_zero_boat"] = float((used["mkt_nzero"] > 0).mean())
    info["used_n_zero_dist"] = {int(k): int(x) for k, x in used["mkt_nzero"].value_counts().sort_index().items()}
    info["used_by_month"] = used["race_date"].dt.strftime("%Y-%m").value_counts().sort_index().to_dict()
    info["zero_boat_wins"] = zero_boat_win_stats(df)
    print(json.dumps(info, ensure_ascii=False, indent=1, default=str), flush=True)

    out = {"odds_info": info, "params": params, "eps_main": EPS_MAIN}
    out["A_lgb"] = run_lgb(df, params)
    out["B_clogit_on_F5"] = run_clogit(df)
    print("B", out["B_clogit_on_F5"]["logloss"], out["B_clogit_on_F5"]["paired_logloss_with_minus_without"], flush=True)

    # ε の感度: 市場のみ（生の暗黙確率）、A の込み、B の込み
    sens = {}
    for eps in ([] if os.environ.get("SKIP_EPS") else EPS_GRID):
        d = assemble(eps)
        y = C.winner_index(d)
        pm = d["mkt_p"].to_numpy().reshape(-1, 6)
        te_mask = (d[d["boat_number"] == 1]["race_date"] >= "2026-07-01").to_numpy()
        s = {"market_only_raw_logloss_all": float(C.per_race_logloss(pm, y).mean()),
             "market_only_raw_logloss_test_jul_sep": float(C.per_race_logloss(pm[te_mask], y[te_mask]).mean()),
             "market_only_raw_brier_test_jul_sep": float(C.per_race_brier(pm[te_mask], y[te_mask]).mean())}
        b = run_clogit(d)
        s["B_with_minus_without"] = b["paired_logloss_with_minus_without"]
        s["B_market_only_recal_logloss"] = b["logloss"]["market_only_recal"]
        if eps != EPS_MAIN:
            a = run_lgb(d, params, with_shap=False)
            s["A_logloss_with"] = a["logloss"]["with"]
            s["A_with_minus_without"] = a["paired_logloss_with_minus_without"]
        else:
            s["A_logloss_with"] = out["A_lgb"]["logloss"]["with"]
            s["A_with_minus_without"] = out["A_lgb"]["paired_logloss_with_minus_without"]
        sens[str(eps)] = s
        print("eps", eps, s["market_only_raw_logloss_test_jul_sep"], s["A_with_minus_without"]["ci95"],
              s["B_with_minus_without"]["ci95"], flush=True)
    out["eps_sensitivity"] = sens

    a = out["A_lgb"]
    ci = a["paired_logloss_with_minus_without"]["ci95"]
    sig = ci[1] < 0
    if sig and a["rank_check"]["stable"]:
        verdict = "採る（有意に良く、他テーマの順位も崩れない）"
    elif sig:
        verdict = "有意に良いが他テーマの順位が崩れる → モデルには入れ、FR-1 では市場を別枠表示する案"
    else:
        verdict = "材料にしない（有意な改善なし）"
    out["verdict"] = verdict
    print(verdict, ci, a["rank_check"], flush=True)
    (C.D / f"md3_v2_result{SUFFIX}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
