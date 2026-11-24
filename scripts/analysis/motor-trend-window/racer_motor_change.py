"""選手の推移の線に「モーターが替わった所」の印を付けるか。work/runs.pkl → result-racer-motor-change.json
1. 選手のモーターは節の境で替わるか（節の中で出走表のモーター2連率が変わる率、同じ会場の続く節で同じ基を引く率）
2. 印に添える値の効き: 選手の基準（艇番×勝率・2連率・3連率・級）に、その節のモーター2連率（会場の中の順位）を足したときの対数損失
"""
import sys, json, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
W, OUT = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(2)
d = pd.read_pickle(f"{W}/runs.pkl")
for c in ["win_rate", "global_2rate", "global_3rate", "motor_2rate"]:
    d[c] = pd.to_numeric(d[c], errors="coerce")
d = d.sort_values(["racer_id", "date", "race_number"]).reset_index(drop=True)
res = {"source": "data/ml/dataset.csv・start_timings.csv（2026-09-14 書き出しの写し）、reconstruct.py の stint（選手×会場の連続出走）"}
# 1. 選手の節（会場が替わるか4日以上あく）。写しの値は小数1桁と2桁が混ざるので m2r1（1桁に丸めた値）で比べる
g = d.groupby("racer_id", sort=False)
gap = (d.date - g.date.shift(1)).dt.days
newmeet = (d.venue_code != g.venue_code.shift(1)) | (gap > 3) | gap.isna()
d["rmeet"] = newmeet.groupby(d.racer_id).cumsum()
x = d[d.race_date >= "2026-03-01"]
per = x.groupby(["racer_id", "rmeet"]).agg(n2=("m2r1", "nunique"), runs=("motor_2rate", "size"), venue=("venue_code", "first"), meet=("meet", "first"), uid=("motor_uid", "first"))
res["withinMeet"] = {"racerMeets": int(len(per)), "shareWithMotorRateChangeInsideMeet": float((per.n2 > 1).mean()),
                     "medianRunsPerRacerMeet": float(per.runs.median())}
# 続く節が同じ会場のとき、同じ基を引いた率（つないだ基だけ）
pr = per.reset_index().sort_values(["racer_id", "rmeet"])
pr["uid_prev"] = pr.groupby("racer_id").uid.shift(1); pr["venue_prev"] = pr.groupby("racer_id").venue.shift(1)
sv = pr[(pr.venue == pr.venue_prev) & pr.uid.notna() & pr.uid_prev.notna() & ~pr.uid.astype(str).str.endswith("x") & ~pr.uid_prev.astype(str).str.endswith("x")]
res["sameVenueConsecutiveMeets"] = {"pairs": int(len(sv)), "sameMotorShare": float((sv.uid == sv.uid_prev).mean()) if len(sv) else None}
res["consecutiveMeetsSameVenueShare"] = float((pr.venue == pr.venue_prev)[pr.venue_prev.notna()].mean())
# 2. 印に添える値: その節のモーター2連率の会場・節の中の順位（パーセンタイル）
d = d[d.race_date >= "2026-03-01"].dropna(subset=["win_rate", "global_2rate", "global_3rate", "motor_2rate"]).copy()
d = d[d.motor_2rate > 0]
d["mrank"] = d.groupby(["venue_code", "meet"]).motor_2rate.rank(pct=True)
B = pd.get_dummies(d.boat_number.astype(int), prefix="b").astype(float); G = pd.get_dummies(d.grade, prefix="g").astype(float)
def X(df, extra):
    Z = pd.concat([B.loc[df.index], G.loc[df.index]], axis=1)
    for b in range(1, 7): Z[f"wr_b{b}"] = df.win_rate * B.loc[df.index, f"b_{b}"]
    Z["r2"] = df.global_2rate / 100; Z["r3"] = df.global_3rate / 100
    for e in extra:
        for b in range(1, 7): Z[f"{e}_b{b}"] = df[e] * B.loc[df.index, f"b_{b}"]
    return Z
def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6); return -(y * np.log(p) + (1 - y) * np.log(1 - p))
def boot_day(diff, days, reps=1000):
    s = pd.DataFrame({"d": diff, "k": days}).groupby("k").d.agg(["sum", "count"])
    idx = rng.integers(0, len(s), (reps, len(s))); v = s["sum"].values[idx].sum(1) / s["count"].values[idx].sum(1)
    return [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
d["m2"] = d.motor_2rate / 100
tr = d.race_date <= "2026-07-31"; te = ~tr
q = {"rows": int(len(d)), "train": "2026-03-01〜07-31", "test": "2026-08-01〜09-14", "testRows": int(te.sum())}
for o in ["win", "top2", "top3"]:
    y = d[o].values
    m0 = LogisticRegression(C=1e4, max_iter=3000).fit(X(d[tr], []), y[tr.values]); l0 = ll(y[te.values], m0.predict_proba(X(d[te], []))[:, 1])
    q[o] = {"baseLogloss": float(l0.mean())}
    for name, extra in [("motor2rate", ["m2"]), ("motorRankInVenueMeet", ["mrank"])]:
        m1 = LogisticRegression(C=1e4, max_iter=3000).fit(X(d[tr], extra), y[tr.values]); l1 = ll(y[te.values], m1.predict_proba(X(d[te], extra))[:, 1])
        diff = l1 - l0
        q[o][name] = {"dLogloss": float(diff.mean()), "relPct": float(100 * diff.mean() / l0.mean()), "ci95": boot_day(diff, d.loc[te, "race_date"].values)}
# 順位の3区分ごとの、選手の基準からの差（2連対、試す期間）
m0 = LogisticRegression(C=1e4, max_iter=3000).fit(X(d[tr], []), d.top2[tr]); d["p2"] = m0.predict_proba(X(d, []))[:, 1]
t = d[te].copy(); t["band"] = pd.cut(t.mrank, [0, 1 / 3, 2 / 3, 1], labels=["low", "mid", "high"])
q["top2ResidByMotorRankBand_test"] = {str(k): {"rows": int(len(v)), "actual": float(v.top2.mean()), "expectedFromRacer": float(v.p2.mean()), "diffPt": float(100 * (v.top2.mean() - v.p2.mean()))} for k, v in t.groupby("band", observed=True)}
res["markAnnotationValue"] = q
json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1, default=float)
print(json.dumps(res, ensure_ascii=False, indent=1, default=float))
