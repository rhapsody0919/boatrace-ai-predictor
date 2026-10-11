"""BOA-822 第2回: C2（類似レース上位400件の1号艇の非1着率、展示前）を v16 の朝のバッチと同じ作り方で過去のレースに作る。
読み取りのみ。入力: ds-round1/boats.pkl（features.build の行）、model/model_win.txt（版 2026-10-06）。
使い方: python c2_rebuild.py repro   # 2026-10-06〜10-10 を日ごとの標準化・λ で（snapshot と照合）
        python c2_rebuild.py sample  # 2025-06-01〜2026-10-10 の日別抽出＋09-22〜10-10 全件。標準化・λ は月初の前日まで
"""
import sys, time, json
from pathlib import Path
import numpy as np, pandas as pd
A = "/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/ml/analogy"
sys.path.insert(0, A)
import features as F
import v16_similar as S
import v16_morning as M
HERE = Path(__file__).parent; R1 = HERE.parent / "ds-round1"
t0 = time.time(); log = lambda *x: print(f"[{time.time()-t0:6.0f}s]", *x, flush=True)
mode = sys.argv[1]

df = pd.read_pickle(R1 / "boats.pkl")
df["race_date"] = pd.to_datetime(df["race_date"])
df = df[df["race_ok"] & (df["race_date"] >= M.POOL_FROM)]
import lightgbm as lgb
feats = lgb.Booster(model_file=str(HERE / "model/model_win.txt")).feature_name()
cols = sorted(set(feats + ["cls_ord", "branch_code", "nat_win", "finish_rank"]) - {"boat_number"}) + ["boat_number"]
races, arrays = M.race_arrays(df, [c for c in cols if c in df.columns])
log("races", len(races))
rd = races["race_date"]
# 重み: 10-06 の朝と同じ（母集団 ≤ 2026-10-05 の中の 2025 年のレースから 5000R の SHAP）
wpool = (rd <= "2026-10-05").to_numpy()
weights, feats2 = M.load_weights(HERE / "model/model_win.txt", df[df["race_id"].isin(races["race_id"][wpool])], races[wpool])
log("weights")
b1 = M.class_names(arrays["cls_ord"])[:, 0]
gap, top = S.gap_band(arrays["nat_win"]), S.top_boat(arrays["nat_win"])
venue = races["venue_code"].astype(int).to_numpy()
rnd = races["round"].to_numpy(dtype=object); grd = races["grade"].to_numpy(dtype=object)
win1 = (M.top3_boats(arrays["finish_rank"])[:, 0] == 1)
rid_s = races["race_id"].map(lambda v: F.int_to_rid(int(v))).to_numpy()

if mode == "repro":
    q_dates = pd.date_range("2026-10-06", "2026-10-10")
    blocks = [(d, d - pd.Timedelta(days=1), [d]) for d in q_dates]
    qidx_all = np.where(rd.between("2026-10-06", "2026-10-10").to_numpy())[0]
else:
    rng = np.random.default_rng(822)
    sel = []
    for d, g in races[rd.between("2025-06-01", "2026-10-10")].groupby("race_date"):
        if d >= pd.Timestamp("2026-09-22"):
            sel += list(g.index)
        else:
            sel += list(rng.choice(g.index, min(8, len(g)), replace=False))
    qidx_all = np.array(sorted(sel))
    months = pd.period_range("2025-06", "2026-10", freq="M")
    blocks = [(m, m.start_time - pd.Timedelta(days=1), None) for m in months]
log("queries", len(qidx_all))
LAM_FIXED = 0.0942 * 1.0 / S.LAM_MULT * S.LAM_MULT
rows = []
for key, cutoff, _ in blocks:
    if mode == "repro":
        q = qidx_all[(rd.iloc[qidx_all] == key).to_numpy()]
    else:
        q = qidx_all[(rd.iloc[qidx_all].dt.to_period("M") == key).to_numpy()]
    if len(q) == 0:
        continue
    pool = (rd <= cutoff).to_numpy()
    if (rd[pool] >= M.CAL[0]).any():
        X, info = M.build_distance(arrays, races, feats, weights, "racecard", pool)
    else:  # cal（2025-06〜12）が母集団に無い月: 標準化は月初の前日まで、λ は 10-06 の朝と同じ値（0.0942）に固定
        bn = S.boat_num_features(feats, "racecard")
        Z, meta, _, _ = S.build_z(arrays, races, bn, "racecard", pool)
        X = Z * S.weight_vector(meta, weights); del Z
        info = {"lambda": LAM_FIXED}
    log(str(key), "X", X.shape, "lambda", round(info["lambda"], 4), "q", len(q))
    for i in q:
        qpool = (rd < rd.iat[i]).to_numpy()
        cond = S.layer_conditions(b1[i], gap[i], top[i], rnd[i], grd[i])
        lm = S.layer_mask(cond, b1, gap, top, rnd, grd) & qpool
        n_layer = int(lm.sum())
        if n_layer == 0:
            rows.append((rid_s[i], 0, 0, np.nan, np.nan)); continue
        idx, d2, d2p = S.rank_layer(X, X[i], venue, int(venue[i]), info["lambda"], lm, 400)
        k = min(400, n_layer)
        w = int(win1[idx[:k]].sum())
        rows.append((rid_s[i], n_layer, k, w, float(np.mean(venue[idx[:k]] == venue[i]))))
    del X
out = pd.DataFrame(rows, columns=["race_id", "n_layer", "n", "b1win", "same_venue_share"])
out["C2"] = 1 - out.b1win / out.n
out.to_csv(HERE / f"c2_{mode}.csv", index=False)
log("done", len(out))
