"""選手の直近N走の率（調子）の検証: 検定。work/rows.pkl → result.json
期間: 基準モデルの学習 2026-03-01〜05-31、調子の係数の学習 06-01〜07-31、試験 08-01〜09-14（時系列で分ける）
"""
import sys, json, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from datetime import datetime, timezone
rows = pd.read_pickle(sys.argv[1]); OUT = sys.argv[2]
NS = [10, 20, 30, 50]; OUTC = ["win", "top2", "top3"]
rng = np.random.default_rng(0)
d = rows.copy()
for c in ["win_rate", "global_2rate", "global_3rate"]:
    d[c] = pd.to_numeric(d[c], errors="coerce")
d = d.dropna(subset=["win_rate", "global_2rate", "global_3rate"])
B = pd.get_dummies(d.boat_number.astype(int), prefix="b").astype(float)
G = pd.get_dummies(d.grade, prefix="g").astype(float)
def base_X(df):
    X = pd.concat([B.loc[df.index], G.loc[df.index]], axis=1)
    for b in range(1, 7):
        X[f"wr_b{b}"] = df.win_rate * B.loc[df.index, f"b_{b}"]
    X["r2"] = df.global_2rate / 100; X["r3"] = df.global_3rate / 100
    return X
dt = d.race_date
fitB = (dt >= "2026-03-01") & (dt <= "2026-05-31")
for o in OUTC:
    m = LogisticRegression(C=1e4, max_iter=2000).fit(base_X(d[fitB]), d.loc[fitB, o])
    d[f"p_{o}"] = m.predict_proba(base_X(d))[:, 1]
    d[f"res_{o}"] = d[o] - d[f"p_{o}"]
g = d.groupby("racer_id", sort=False)
for o in OUTC:
    prev = g[f"res_{o}"].shift(1)
    for n in NS:
        d[f"form_{o}_r{n}"] = prev.groupby(d.racer_id).transform(lambda x, n=n: x.rolling(n, min_periods=n).mean())
    d[f"res_{o}_next10"] = g[f"res_{o}"].transform(lambda x: x[::-1].rolling(10, min_periods=10).mean()[::-1].shift(-1))
# 母集団: 6月以降、データ内の過去50走以上（全 N で同じ行）
ok = d[[f"{o}_r50" for o in OUTC] + [f"form_{o}_r50" for o in OUTC]].notna().all(axis=1) & (dt >= "2026-06-01")
E = d[ok].copy()
tr = E.race_date <= "2026-07-31"; te = ~tr
def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6); return -(y * np.log(p) + (1 - y) * np.log(1 - p))
def boot_day(diff, days, reps=1000):
    s = pd.DataFrame({"d": diff, "k": days}).groupby("k").d.agg(["sum", "count"])
    idx = rng.integers(0, len(s), (reps, len(s)))
    v = s["sum"].values[idx].sum(1) / s["count"].values[idx].sum(1)
    return [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
res = {"generatedAt": datetime.now(timezone.utc).isoformat(), "source": "data/ml/dataset.csv・start_timings.csv（scripts/ml/export-training-data.js、2026-09-14 書き出しの本番の写し）",
       "population": {"evalRows": int(ok.sum()), "trainRows": int(tr.sum()), "testRows": int(te.sum()), "racers": int(E.racer_id.nunique()),
                      "train": "2026-06-01〜07-31", "test": "2026-08-01〜09-14", "baselineFit": "2026-03-01〜05-31",
                      "condition": "データ内の過去50走以上（データの選手IDは2026-02 85%・03以降100%、それ以前は約2割）"}}
# Q1a: 次の1走。基準（艇番×出走表の勝率・2連率・3連率・級）に足して対数損失が下がるか
q1 = {}
for o in OUTC:
    y = E[o].values; logit_p = np.log(E[f"p_{o}"] / (1 - E[f"p_{o}"]))
    base_ll = ll(y[te.values], E.loc[te, f"p_{o}"].values)
    out = {"baseLogloss": float(base_ll.mean()), "byN": {}}
    for n in NS + ["exp"]:
        feats = {}
        if n == "exp":
            feats["rawRate_only"] = E[[f"{o}_exp"]]
        else:
            feats["residForm"] = E[[f"form_{o}_r{n}"]]
            feats["rawMinusExpanding"] = (E[f"{o}_r{n}"] - E[f"{o}_exp"]).rename("dev").to_frame()
        r = {}
        for name, F in feats.items():
            X = pd.concat([logit_p.rename("lp"), F], axis=1)
            mdl = LogisticRegression(C=1e4, max_iter=1000).fit(X[tr], y[tr.values])
            p = mdl.predict_proba(X[te])[:, 1]
            diff = ll(y[te.values], p) - base_ll
            r[name] = {"dLogloss": float(diff.mean()), "ci95": boot_day(diff, E.loc[te, "race_date"].values), "coef": [float(c) for c in mdl.coef_[0]]}
        out["byN"][str(n)] = r
    q1[o] = out
res["q1_nextRace_logloss"] = q1
# Q1b: 調子（過去N走の残差の平均）と次の10走の残差の平均の相関。重ならないよう選手ごとに10走おきに抜く
q1b = {}
Et = E[te | tr].copy(); Et["j"] = Et.groupby("racer_id").cumcount()
S = Et[(Et.j % 10 == 0)]
for o in OUTC:
    q1b[o] = {}
    for n in NS:
        x = S[[f"form_{o}_r{n}", f"res_{o}_next10"]].dropna()
        rs = []
        ids = x.index.values; racers = S.loc[ids, "racer_id"].values; ur = np.unique(racers)
        grp = {r_: np.where(racers == r_)[0] for r_ in ur}
        for _ in range(500):
            pick = np.concatenate([grp[r_] for r_ in rng.choice(ur, len(ur))])
            rs.append(np.corrcoef(x.values[pick, 0], x.values[pick, 1])[0, 1])
        q1b[o][str(n)] = {"r": float(np.corrcoef(x.values[:, 0], x.values[:, 1])[0, 1]), "ci95": [float(np.percentile(rs, 2.5)), float(np.percentile(rs, 97.5))], "pairs": int(len(x))}
res["q1b_formVsNext10Residual"] = q1b
# Q1c: ST。次の1走の ST（F を除く）を、過去N走の平均と過去の全部の平均のどちらが当てるか（MSE）、両方の混ぜ
st = E.dropna(subset=["st", "st_exp"] + [f"st_r{n}" for n in NS])
q1c = {"rows": int(len(st)), "byN": {}}
tst = st.race_date > "2026-07-31"
mse_exp = ((st.st - st.st_exp) ** 2)[tst]
q1c["mseExpanding"] = float(mse_exp.mean())
for n in NS:
    e_n = ((st.st - st[f"st_r{n}"]) ** 2)[tst]
    # 混ぜの重み w を学習期で最小二乗
    a = (st[f"st_r{n}"] - st.st_exp)[~tst]; b = (st.st - st.st_exp)[~tst]
    w = float((a * b).sum() / (a * a).sum())
    blend = st.st_exp + w * (st[f"st_r{n}"] - st.st_exp)
    e_b = ((st.st - blend) ** 2)[tst]
    q1c["byN"][str(n)] = {"mseRolling": float(e_n.mean()), "dMseRollingVsExp": float((e_n - mse_exp).mean()), "ci95": boot_day((e_n - mse_exp).values, st.loc[tst, "race_date"].values),
                          "blendWeightOnRolling": w, "dMseBlendVsExp": float((e_b - mse_exp).mean()), "ci95Blend": boot_day((e_b - mse_exp).values, st.loc[tst, "race_date"].values)}
# ST の次の10走平均との相関（過去N走の平均 − 過去全部の平均）
x = S.dropna(subset=["st_exp", "st_next10"] + [f"st_r{n}" for n in NS])
q1c["devVsNext10Dev"] = {str(n): float(np.corrcoef(x[f"st_r{n}"] - x.st_exp, x.st_next10 - x.st_exp)[0, 1]) for n in NS}
q1c["devVsNext10Dev_pairs"] = int(len(x))
res["q1c_st"] = q1c
# Q2: 偶然の幅。N走の窓の値の95%の幅（二項）と、選手の中の窓の値の動きのうち偶然で説明できる割合
q2 = {"binomialHalfWidth95pt": {}, "withinRacerSignalShare": {}}
for o, p0 in [("win", None), ("top2", None), ("top3", None)]:
    pm = float(E[o].mean())
    q2["binomialHalfWidth95pt"][o] = {"pMean": pm, **{str(n): float(196 * np.sqrt(pm * (1 - pm) / n)) for n in NS},
                                     "at_p": {str(p): {str(n): float(196 * np.sqrt(p * (1 - p) / n)) for n in NS} for p in [0.1, 0.2, 0.3, 0.5, 0.7]}}
# 選手ごとに重ならない N 走の塊の残差の平均。観測の分散 vs 偶然の分散（Σp(1-p)/N^2）
full = d[d.race_date >= "2026-03-01"].copy(); full["j"] = full.groupby("racer_id").cumcount()
for o in OUTC:
    q2["withinRacerSignalShare"][o] = {}
    for n in NS:
        full["blk"] = full.j // n
        agg = full.groupby(["racer_id", "blk"]).agg(m=(f"res_{o}", "mean"), c=(f"res_{o}", "size"), v=(f"p_{o}", lambda p: float((p * (1 - p)).sum())))
        agg = agg[agg.c == n]; agg["noise"] = agg.v / n ** 2
        # 選手の中の分散（選手の平均を引く）
        agg["dm"] = agg.m - agg.groupby(level=0).m.transform("mean")
        k = agg.groupby(level=0).m.transform("size"); agg = agg[k >= 2]; k = k[k >= 2]
        obs = float((agg.dm ** 2 * k / (k - 1)).mean()); noise = float(agg.noise.mean())
        q2["withinRacerSignalShare"][o][str(n)] = {"blocks": int(len(agg)), "obsVarWithin": obs, "noiseVar": noise, "signalShare": float(max(0, 1 - noise / obs))}
# ST の偶然の幅: 選手の中の1走の ST の標準偏差 / sqrt(N)
sd_in = float(d[d.race_date >= "2026-03-01"].groupby("racer_id").st.std().median())
q2["st"] = {"withinRacerSdMedian": sd_in, **{f"halfWidth95_N{n}": float(1.96 * sd_in / np.sqrt(n)) for n in NS}}
full2 = d[(d.race_date >= "2026-03-01") & d.st.notna()].copy(); full2["j"] = full2.groupby("racer_id").cumcount()
q2["stSignalShare"] = {}
for n in NS:
    full2["blk"] = full2.j // n
    agg = full2.groupby(["racer_id", "blk"]).st.agg(["mean", "size", "var"]); agg = agg[agg["size"] == n]
    k = agg.groupby(level=0)["mean"].transform("size"); agg = agg[k >= 2]; k = k[k >= 2]
    dm = agg["mean"] - agg.groupby(level=0)["mean"].transform("mean")
    obs = float((dm ** 2 * k / (k - 1)).mean()); noise = float((agg["var"] / n).mean())
    q2["stSignalShare"][str(n)] = {"blocks": int(len(agg)), "obsVarWithin": obs, "noiseVar": noise, "signalShare": float(max(0, 1 - noise / obs))}
res["q2_noise"] = q2
json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1)[:12000])
