"""BOA-822 第3回: 類似レース（v16）の展示前・展示後の C2 を過去のレースに作る。読み取りのみ。
対象: 第2回の抽出（ds-round2/c2_sample.csv の 6,693R）＋ 2025-06-01〜2026-10-10 で層が400件未満の全レース。
展示後は本番（scripts/lib/analogyV16Exhibition.js・src/utils/analogySimilarRerank.js）と同じく、展示前の距離の上位
30,000件（MAX_CANDIDATES）を展示後の距離（展示の列を足した距離²＋会場違いの λ_e）で並べ直す。
標準化・λ は月初の前日までの母集団（第2回と同じ近似。日ごとの値との差は最大 0.0025）。
入力: ds-round1/boats.pkl、ds-round2/model/model_win.txt（版 2026-10-06）、ds-round2/c2_sample.csv
"""
import sys, time
from pathlib import Path
import numpy as np, pandas as pd
A = "/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/ml/analogy"
sys.path.insert(0, A)
import features as F
import v16_similar as S
import v16_morning as M
HERE = Path(__file__).parent; R1 = HERE.parent / "round1"; R2 = HERE.parent / "round2"
t0 = time.time(); log = lambda *x: print(f"[{time.time()-t0:6.0f}s]", *x, flush=True)
df = pd.read_pickle(R1 / "boats.pkl")
df["race_date"] = pd.to_datetime(df["race_date"])
df = df[df["race_ok"] & (df["race_date"] >= M.POOL_FROM)]
import lightgbm as lgb
MODEL = R2 / "model/model_win.txt"
feats = lgb.Booster(model_file=str(MODEL)).feature_name()
cols = sorted(set(feats + ["cls_ord", "branch_code", "nat_win", "finish_rank"]) - {"boat_number"}) + ["boat_number"]
races, arrays = M.race_arrays(df, [c for c in cols if c in df.columns])
rd = races["race_date"]
wpool = (rd <= "2026-10-05").to_numpy()
weights, _ = M.load_weights(MODEL, df[df["race_id"].isin(races["race_id"][wpool])], races[wpool])
log("races", len(races), "weights")
b1 = M.class_names(arrays["cls_ord"])[:, 0]
gap, top = S.gap_band(arrays["nat_win"]), S.top_boat(arrays["nat_win"])
venue = races["venue_code"].astype(int).to_numpy()
rnd = races["round"].to_numpy(dtype=object); grd = races["grade"].to_numpy(dtype=object)
win1 = (M.top3_boats(arrays["finish_rank"])[:, 0] == 1)
rid_s = races["race_id"].map(lambda v: F.int_to_rid(int(v))).to_numpy()
exh_ok = np.isfinite(arrays["exh_time"]).all(1)

# 層の件数（前日まで）を全レースで: キー（級・帯・トップ・ラウンド固定・G1以上）ごとの日付の累積
rfix = np.where(np.isin(rnd, S.ROUND_FIX), rnd, None)
g1 = np.isin(grd, S.GRADE_G1_PLUS)
base = pd.DataFrame({"b1": b1, "gap": gap, "top": top, "rnd": rnd, "g1": g1, "date": rd.to_numpy()})
def cum_before(keys):
    g = base.groupby(keys + ["date"], dropna=False).size().rename("n").reset_index().sort_values(keys + ["date"])
    g["c"] = g.groupby(keys, dropna=False)["n"].cumsum() - g["n"]
    return g
need_round = pd.Series(rfix).notna().to_numpy()
q = base.copy(); q["rnd_q"] = rfix; q["g1_q"] = g1
n_layer = np.zeros(len(base), int)
for use_r in (False, True):
    for use_g in (False, True):
        sel = (need_round == use_r) & (g1 == use_g)
        keys = ["b1", "gap", "top"] + (["rnd"] if use_r else []) + (["g1"] if use_g else [])
        src = base if not use_g else base[base["g1"]]
        g = src.groupby(keys + ["date"], dropna=False).size().rename("n").reset_index().sort_values("date")
        g["cum"] = g.groupby(keys, dropna=False)["n"].cumsum()
        t = base.loc[sel, keys + ["date"]].reset_index()
        t["_k"] = t[keys].astype(str).agg("|".join, axis=1); g["_k"] = g[keys].astype(str).agg("|".join, axis=1)
        m = pd.merge_asof(t.sort_values("date"), g[["_k", "date", "cum"]].sort_values("date"), on="date", by="_k",
                          allow_exact_matches=False)
        n_layer[m["index"].to_numpy()] = m["cum"].fillna(0).astype(int).to_numpy()
period = rd.between("2025-06-01", "2026-10-10").to_numpy()
small = np.where(period & (n_layer < 400))[0]
samp = set(pd.read_csv(R2 / "c2_sample.csv")["race_id"])
qidx = np.array(sorted(set(np.where(np.isin(rid_s, list(samp)))[0]) | set(small)))
pd.DataFrame({"race_id": rid_s[period], "n_layer_count": n_layer[period]}).to_csv(HERE / "layer_counts.csv", index=False)
log("period races", int(period.sum()), "small(<400)", len(small), "queries", len(qidx))

def build(arrays, races, feats, weights, stage, pool):
    """M.build_distance と同じ。cal（2025-06〜12-02）が母集団に無い月だけ、λ の基準の期間を
    pool_cal=2019-04〜2024-11-30・cal=2024-12-01〜月初の前日 にずらす（距離だけで結果は使わない）"""
    if (rd[pool] >= M.CAL[0]).any():
        return M.build_distance(arrays, races, feats, weights, stage, pool)
    bn = S.boat_num_features(feats, stage)
    Z, meta, norm, cats = S.build_z(arrays, races, bn, stage, pool)
    X = Z * S.weight_vector(meta, weights); del Z
    pc = np.where((rd >= M.POOL_CAL[0]) & (rd <= "2024-11-30") & pool)[0]
    ca = np.where((rd >= "2024-12-01") & pool)[0]
    L = S.lambda_base(X, pc, ca)
    return X, {"lambda": L * S.LAM_MULT}
rows = []
for mth in pd.period_range("2025-06", "2026-10", freq="M"):
    qq = qidx[(rd.iloc[qidx].dt.to_period("M") == mth).to_numpy()]
    if len(qq) == 0:
        continue
    pool = (rd <= mth.start_time - pd.Timedelta(days=1)).to_numpy()
    X, info = build(arrays, races, feats, weights, "racecard", pool)
    Xe, info_e = build(arrays, races, feats, weights, "exhibition", pool)
    log(str(mth), "q", len(qq), "lam", round(info["lambda"], 4), "lam_e", round(info_e["lambda"], 4))
    for i in qq:
        qpool = (rd < rd.iat[i]).to_numpy()
        cond = S.layer_conditions(b1[i], gap[i], top[i], rnd[i], grd[i])
        lm = S.layer_mask(cond, b1, gap, top, rnd, grd) & qpool
        nl = int(lm.sum())
        if nl == 0:
            rows.append((rid_s[i], 0, 0, np.nan, 0, np.nan, bool(exh_ok[i]))); continue
        idx, _, _ = S.rank_layer(X, X[i], venue, int(venue[i]), info["lambda"], lm, M.MAX_CANDIDATES)
        k = min(400, nl)
        w_rc = int(win1[idx[:k]].sum())
        d2e = ((Xe[idx] - Xe[i]) ** 2).sum(1) + np.where(venue[idx] != venue[i], np.float32(info_e["lambda"]), 0)
        ie = idx[np.argsort(d2e, kind="stable")[:k]]
        w_ex = int(win1[ie].sum())
        rows.append((rid_s[i], nl, k, w_rc, k, w_ex, bool(exh_ok[i])))
    del X, Xe
out = pd.DataFrame(rows, columns=["race_id", "n_layer", "n", "b1win_rc", "n_ex", "b1win_ex", "exh_ok"])
out["C2"] = 1 - out.b1win_rc / out.n; out["C2e"] = 1 - out.b1win_ex / out.n_ex
out["in_sample"] = out.race_id.isin(samp)
out.to_csv(HERE / "c2_round3.csv", index=False)
log("done", len(out))
