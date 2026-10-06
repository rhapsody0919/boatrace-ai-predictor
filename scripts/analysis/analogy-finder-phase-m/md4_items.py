"""BOA-271 Phase M — MD-4 遡って取れる未定項目の取る／取らない判定

方法（全項目共通）:
  各項目がそろう期間のレースで、主モデル（F5: 2025-12-02 までで学習、長期項目のみ）の
  レース内スコア z を土台にした条件付きロジット（6艇の softmax）を2つ比べる。
    入れない: u = a·z + 艇番の切片
    入れる  : u = a·z + 艇番の切片 + β·x（x = その項目から作った艇ごとの特徴量）
  日単位のブロックで5分割の交差検証（各ブロックは連続した日）。予測は全て out-of-fold。
  指標は1着艇の6クラス対数損失・Brier のレース単位ペア差（入れる−入れない）、ブートストラップ95%CI。
  ※ 期間が短い項目でも LightGBM を一から学習せずに上積みを測るための設計。線形の上積みしか見ない。

判定（事前固定）:
  取る     : 対数損失のペア差 CI 上限 < 0
  取らない : CI 下限 > -0.001（0.001 nats/レース を超える改善を否定できる）または有意に悪化
  判定不能 : それ以外。観測された効果量（改善方向でなければ 0.001）を 80% の検出力・両側5%で
             検出するのに必要なレース数と、その項目の1日あたりレース数から必要日数を出す
"""

from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize

import common as C
from build_dataset import read, rid_to_int

DELTA = 0.001
Z = 1.959964 + 0.841621  # 両側5%、検出力80%
COSTS = {  # spec MD-4 のリクエスト数（過去分の取り直し）
    "F/L数（racelist）": "racelist 約4.3万リクエスト",
    "登録体重（racelist）": "racelist 約4.3万リクエスト（F/L・支部と同じ取得）",
    "支部（racelist）": "racelist 約4.3万リクエスト（F/L・体重と同じ取得）",
    "展示ST": "直前情報ページ 約15,240リクエスト",
    "公式コンピュータ予想": "約2.7万リクエスト",
    "展示進入": "過去分は取得元に残らない（2026-09-21〜の蓄積のみ）",
    "チルト": "過去分は取得元に残らない（2026-09-22〜の蓄積のみ）",
    "オリジナル展示": "過去分は取得元に残らない（2026-09-22〜の蓄積のみ）",
    "ピットレポート": "BOA-365 で取得範囲を確認中",
    "3連率": "K/B 補完（10/5 予定）で本体テーブルの穴が埋まる。追加リクエストなし",
    "気温・水温": "K/B 補完（10/5 予定）で本体テーブルの穴が埋まる。追加リクエストなし",
}


def centered(df, col):
    v = pd.to_numeric(df[col], errors="coerce")
    return v - v.groupby(df["race_id"]).transform("mean")


def parse_official(df: pd.DataFrame) -> pd.DataFrame:
    """公式コンピュータ予想（focus_3t / focus_2t / confidence）→ 艇ごとの特徴量。"""
    op = pd.read_csv(C.D / "official_pred.csv")
    op["race_id"] = (op["race_date"].astype(str) + "-" + op["venue_code"].astype(int).map("{:02d}".format)
                     + "-" + op["race_no"].astype(int).map("{:02d}".format))
    rows = []
    for rid, payload in zip(op["race_id"], op["payload"]):
        try:
            p = json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            continue
        f3 = p.get("focus_3t") or []
        f2 = p.get("focus_2t") or []
        first = np.zeros(7); anyb = np.zeros(7); first2 = np.zeros(7)
        for pat in f3:
            toks = [int(x) for x in pat["pattern"].replace("=", "-").split("-")]
            seps = pat.get("seps") or []
            grp = [toks[0]]
            for i, s in enumerate(seps):
                if s == "=":
                    grp.append(toks[i + 1])
                else:
                    break
            for b in grp:
                first[b] += 1 / len(grp)
            for b in set(toks):
                anyb[b] += 1
        for pat in f2:
            toks = [int(x) for x in pat["pattern"].replace("=", "-").split("-")]
            grp = toks if (pat.get("seps") or ["-"])[0] == "=" else toks[:1]
            for b in grp:
                first2[b] += 1 / len(grp)
        n3, n2 = max(len(f3), 1), max(len(f2), 1)
        conf = p.get("confidence")
        for b in range(1, 7):
            rows.append({"race_id": rid, "boat_number": b, "op_first3": first[b] / n3,
                         "op_any3": anyb[b] / n3, "op_first2": first2[b] / n2,
                         "op_conf": float(conf) if conf is not None else np.nan,
                         "op_n3": len(f3)})
    out = pd.DataFrame(rows)
    out["race_id"] = rid_to_int(out["race_id"])
    return out


def load_orig_ex() -> pd.DataFrame:
    v = read("orig_exhibition")
    w = v.pivot_table(index=["race_id", "boat_number"], columns="kind", values="value").reset_index()
    return w.rename(columns={"一周": "ox_lap", "まわり足": "ox_turn", "直線": "ox_straight",
                             "半周ラップ": "ox_half"})


def build_items(df: pd.DataFrame) -> dict:
    """項目名 → (対象レースの条件, 特徴量列のリスト)。特徴量は df に列として足す。"""
    items = {}
    for c in ("nat_3", "loc_3", "motor_3", "boat_3"):
        df[f"x_{c}"] = centered(df, c)
    items["3連率"] = (df[["nat_3", "loc_3", "motor_3", "boat_3"]].notna().all(axis=1),
                     ["x_nat_3", "x_loc_3", "x_motor_3", "x_boat_3"])
    tw = []
    for c in ("temperature", "water_temp"):
        for b in range(2, 7):
            df[f"x_{c}_b{b}"] = pd.to_numeric(df[c], errors="coerce") * (df["boat_number"] == b)
            tw.append(f"x_{c}_b{b}")
    items["気温・水温"] = (df[["temperature", "water_temp"]].notna().all(axis=1), tw)
    df["x_exh_st"] = centered(df, "exh_st")
    df["x_exh_st_b1"] = pd.to_numeric(df["exh_st"], errors="coerce") * (df["boat_number"] == 1)
    items["展示ST"] = (df["exh_st"].notna(), ["x_exh_st", "x_exh_st_b1"])
    ec = pd.to_numeric(df["exh_course"], errors="coerce")
    df["x_course_shift"] = df["boat_number"] - ec
    for k in range(2, 7):
        df[f"x_exh_course_{k}"] = (ec == k).astype(float)
    items["展示進入"] = (ec.notna(), ["x_course_shift"] + [f"x_exh_course_{k}" for k in range(2, 7)])
    df["x_tilt"] = centered(df, "tilt")
    df["x_tilt_out"] = pd.to_numeric(df["tilt"], errors="coerce") * (df["boat_number"] >= 4)
    items["チルト"] = (df["tilt"].notna(), ["x_tilt", "x_tilt_out"])
    ox = [c for c in ("ox_lap", "ox_turn", "ox_straight", "ox_half") if c in df.columns]
    for c in ox:
        df[f"x_{c}"] = centered(df, c)
    items["オリジナル展示"] = (df[ox].notna().any(axis=1), [f"x_{c}" for c in ox])
    for c in ("op_first3", "op_any3", "op_first2"):
        df[f"x_{c}"] = pd.to_numeric(df[c], errors="coerce")
    items["公式コンピュータ予想"] = (df["op_first3"].notna(), ["x_op_first3", "x_op_any3", "x_op_first2"])
    df["x_f"] = pd.to_numeric(df["f_count"], errors="coerce")
    df["x_l"] = pd.to_numeric(df["l_count"], errors="coerce")
    items["F/L数（racelist）"] = (df["f_count"].notna(), ["x_f", "x_l"])
    df["x_weight_fresh"] = centered(df, "weight_fresh")
    items["登録体重（racelist）"] = (df["weight_fresh"].notna(), ["x_weight_fresh"])
    return items


def clogit_fit(z, X, y, l2=1e-3):
    """u = a·z + X·β の条件付きロジット。z: (R,6), X: (R,6,K), y: (R,)"""
    K = X.shape[2]

    def f(w):
        a, beta = w[0], w[1:]
        u = a * z + (X @ beta if K else 0)
        u = u - u.max(1, keepdims=True)
        lse = np.log(np.exp(u).sum(1))
        ll = u[np.arange(len(y)), y] - lse
        p = np.exp(u - lse[:, None])
        oh = np.zeros_like(p); oh[np.arange(len(y)), y] = 1
        g_u = (p - oh) / len(y)
        ga = (g_u * z).sum()
        gb = np.einsum("rj,rjk->k", g_u, X) if K else np.zeros(0)
        return -ll.mean() + l2 * (beta ** 2).sum(), np.concatenate([[ga], gb + 2 * l2 * beta])
    w0 = np.zeros(K + 1); w0[0] = 1.0
    return minimize(f, w0, jac=True, method="L-BFGS-B").x


def clogit_pred(w, z, X):
    K = X.shape[2]
    u = w[0] * z + (X @ w[1:] if K else 0)
    return C.softmax_rows(u)


BOAT_DUMMIES = np.eye(6)[:, 1:]  # (6艇, 5)


def eval_item(sub: pd.DataFrame, feats, n_blocks=5):
    sub = sub.sort_values(["race_date", "race_id", "boat_number"])
    z = sub["z"].to_numpy().reshape(-1, 6)
    y = C.winner_index(sub)
    Xr = sub[feats].astype(float).to_numpy().reshape(-1, 6, len(feats))
    days = sub[sub["boat_number"] == 1]["race_date"].to_numpy()
    ud = np.unique(days)
    blocks = np.array_split(ud, min(n_blocks, len(ud)))
    p0 = np.zeros_like(z); p1 = np.zeros_like(z)
    for blk in blocks:
        te = np.isin(days, blk); tr = ~te
        X = Xr.copy()
        mu = np.nanmean(X[tr].reshape(-1, len(feats)), axis=0)
        sd = np.nanstd(X[tr].reshape(-1, len(feats)), axis=0)
        sd[~np.isfinite(sd) | (sd == 0)] = 1
        X = (X - mu) / sd
        X = np.nan_to_num(X, nan=0.0)
        # 両モデルに艇番の切片（2〜6号艇のダミー）を入れる。土台モデルの期間ずれ（艇番ごとの
        # 1着率の再較正）を項目の効果と取り違えないため
        Xb = np.concatenate([BOAT_DUMMIES[None].repeat(len(X), 0), X], axis=2)
        w0 = clogit_fit(z[tr], Xb[tr][:, :, :5], y[tr])
        w1 = clogit_fit(z[tr], Xb[tr], y[tr])
        p0[te] = clogit_pred(w0, z[te], Xb[te][:, :, :5])
        p1[te] = clogit_pred(w1, z[te], Xb[te])
    l0, l1 = C.per_race_logloss(p0, y), C.per_race_logloss(p1, y)
    b0, b1 = C.per_race_brier(p0, y), C.per_race_brier(p1, y)
    d = l1 - l0
    ci = C.paired_ci(d, clusters=days)
    n_days = len(ud)
    rpd = len(y) / n_days
    sd = float(d.std(ddof=1))
    eff = -ci["mean"] if ci["mean"] < 0 else DELTA
    n_req = int(np.ceil((Z * sd / eff) ** 2))
    if ci["ci95"][1] < 0:
        verdict = "取る"
    elif ci["ci95"][0] > -DELTA or ci["ci95"][0] > 0:
        verdict = "取らない"
    else:
        verdict = "判定不能"
    return {
        "n_races": int(len(y)), "n_days": int(n_days), "period": [str(pd.Timestamp(days.min()).date()),
                                                                  str(pd.Timestamp(days.max()).date())],
        "races_per_day": float(rpd),
        "logloss_without": float(l0.mean()), "logloss_with": float(l1.mean()),
        "brier_without": float(b0.mean()), "brier_with": float(b1.mean()),
        "paired_logloss_with_minus_without": ci,
        "paired_brier_with_minus_without": C.paired_ci(b1 - b0),
        "sd_per_race_diff": sd,
        "effect_for_power": eff, "effect_is_observed": bool(ci["mean"] < 0),
        "n_races_required_80pct": n_req,
        "days_required_at_current_rate": float(n_req / rpd),
        "verdict": verdict,
    }


def main():
    df = pd.read_pickle(C.D / "boats.pkl")
    df = C.complete_races(df)
    df = df[df["src"] == "main"].copy()
    df = df.merge(parse_official(df), on=["race_id", "boat_number"], how="left")
    df = df.merge(load_orig_ex(), on=["race_id", "boat_number"], how="left")
    m = lgb.Booster(model_file=str(C.D / "main_win_F5.txt"))
    df["z"] = m.predict(df[C.BASE_FEATURES].astype(float), raw_score=True)
    items = build_items(df)

    out = {"method": "F5主モデルのスコア＋艇番の切片を土台にした条件付きロジット、日ブロック5分割CV", "items": {}}
    for name, (cond, feats) in items.items():
        ok = cond.groupby(df["race_id"]).transform("all")
        sub = df[ok]
        if name in ("3連率", "気温・水温", "展示ST"):
            # 穴の期間（2025-12-03〜2026-03-31）は使わない
            sub = sub[(sub["race_date"] >= "2026-04-01") & (sub["race_date"] <= "2026-09-30")]
        else:
            sub = sub[sub["race_date"] <= "2026-09-30"]
        if sub["race_id"].nunique() < 50:
            out["items"][name] = {"n_races": int(sub["race_id"].nunique()), "verdict": "判定不能",
                                  "note": "レース数が50未満で推定できない"}
            continue
        r = eval_item(sub, feats)
        r["features"] = feats
        r["cost"] = COSTS.get(name)
        # 月別のレース数（どの期間で測ったか）
        r["races_by_month"] = sub[sub["boat_number"] == 1]["race_date"].dt.strftime("%Y-%m") \
            .value_counts().sort_index().to_dict()
        out["items"][name] = r
        print(name, r["n_races"], r["logloss_without"], r["logloss_with"],
              r["paired_logloss_with_minus_without"]["ci95"], r["verdict"])

    # 支部: 長期（kb）に毎走あり、前方補完で埋まるかを測る
    p = df[(df["race_date"] >= "2026-04-01") & (df["race_date"] <= "2026-09-30")]
    out["items"]["支部（racelist）"] = {
        "branch_missing_after_asof_ffill_2026_04_09": float(p["branch"].isna().mean()),
        "weight_missing_after_asof_ffill_2026_04_09": float(p["weight"].isna().mean()),
        "branch_was_missing_before_ffill_2026_04_09": float(p["branch_was_missing"].mean()),
        "cost": COSTS["支部（racelist）"],
        "note": "支部は長期（kb）に毎走あり、選手単位でほぼ変わらないため as-of 前方補完で足りる",
    }
    # ピットレポート
    pc = pd.read_csv(C.D / "pit_comments_count.csv") if (C.D / "pit_comments_count.csv").exists() else None
    out["items"]["ピットレポート"] = {
        "n_races": int(pc["n"].iloc[0]) if pc is not None else None,
        "verdict": "判定不能", "cost": COSTS["ピットレポート"],
    }
    (C.D / "md4_result.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
