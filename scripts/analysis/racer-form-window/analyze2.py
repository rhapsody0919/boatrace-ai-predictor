"""追加の検定: 基準にモーター2連率を足し、調子を「今の節より前の走」だけで作る（節の中のモーター・水面の効きを除く）。"""
import sys, json, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
rows = pd.read_pickle(sys.argv[1]); OUT = sys.argv[2]
NS = [10, 20, 30, 50]; OUTC = ["win", "top2", "top3"]; rng = np.random.default_rng(1)
d = rows.copy()
for c in ["win_rate", "global_2rate", "global_3rate", "motor_2rate"]:
    d[c] = pd.to_numeric(d[c], errors="coerce")
d = d.dropna(subset=["win_rate", "global_2rate", "global_3rate", "motor_2rate"]).sort_values(["racer_id", "race_date", "race_number"])
# 節: 同じ選手で会場が変わるか日付が3日以上あいたら新しい節
dd = pd.to_datetime(d.race_date)
g0 = d.groupby("racer_id", sort=False)
new = (d.venue_code != g0.venue_code.shift(1)) | ((dd - dd.groupby(d.racer_id).shift(1)).dt.days > 2)
d["meet"] = new.groupby(d.racer_id).cumsum()
B = pd.get_dummies(d.boat_number.astype(int), prefix="b").astype(float); G = pd.get_dummies(d.grade, prefix="g").astype(float)
def base_X(df):
    X = pd.concat([B.loc[df.index], G.loc[df.index]], axis=1)
    for b in range(1, 7):
        X[f"wr_b{b}"] = df.win_rate * B.loc[df.index, f"b_{b}"]
        X[f"mo_b{b}"] = df.motor_2rate / 100 * B.loc[df.index, f"b_{b}"]
    X["r2"] = df.global_2rate / 100; X["r3"] = df.global_3rate / 100
    return X
fitB = (d.race_date >= "2026-03-01") & (d.race_date <= "2026-05-31")
for o in OUTC:
    m = LogisticRegression(C=1e4, max_iter=3000).fit(base_X(d[fitB]), d.loc[fitB, o])
    d[f"p_{o}"] = m.predict_proba(base_X(d))[:, 1]; d[f"res_{o}"] = d[o] - d[f"p_{o}"]
g = d.groupby("racer_id", sort=False)
first = new.values
for o in OUTC:
    prev = g[f"res_{o}"].shift(1); prevraw = g[o].shift(1)
    for n in NS:
        f_all = prev.groupby(d.racer_id).transform(lambda x, n=n: x.rolling(n, min_periods=n).mean())
        raw_all = prevraw.groupby(d.racer_id).transform(lambda x, n=n: x.rolling(n, min_periods=n).mean())
        d[f"form_{o}_r{n}"] = f_all
        # 節より前だけ: 節の初日の最初の走の値を節の中に引き延ばす
        d[f"pform_{o}_r{n}"] = f_all.where(first).groupby([d.racer_id, d.meet]).transform("first")
        d[f"praw_{o}_r{n}"] = raw_all.where(first).groupby([d.racer_id, d.meet]).transform("first")
    d[f"pexp_{o}"] = prevraw.groupby(d.racer_id).transform(lambda x: x.expanding().mean()).where(first).groupby([d.racer_id, d.meet]).transform("first")
cols = [f"pform_{o}_r50" for o in OUTC] + [f"form_{o}_r50" for o in OUTC]
ok = d[cols].notna().all(axis=1) & (d.race_date >= "2026-06-01")
E = d[ok].copy(); tr = E.race_date <= "2026-07-31"; te = ~tr
def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6); return -(y * np.log(p) + (1 - y) * np.log(1 - p))
def boot_day(diff, days, reps=1000):
    s = pd.DataFrame({"d": diff, "k": days}).groupby("k").d.agg(["sum", "count"])
    idx = rng.integers(0, len(s), (reps, len(s))); v = s["sum"].values[idx].sum(1) / s["count"].values[idx].sum(1)
    return [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
res = {"population": {"evalRows": int(ok.sum()), "testRows": int(te.sum()), "racers": int(E.racer_id.nunique()), "meetsMedianRunsPerMeet": float(d.groupby(["racer_id", "meet"]).size().median())}, "q": {}}
for o in OUTC:
    y = E[o].values; lp = np.log(E[f"p_{o}"] / (1 - E[f"p_{o}"])).rename("lp"); base = ll(y[te.values], E.loc[te, f"p_{o}"].values)
    out = {"baseLogloss": float(base.mean())}
    for n in NS:
        for name, F in {"residForm_inclCurrentMeet": E[[f"form_{o}_r{n}"]], "residForm_priorMeets": E[[f"pform_{o}_r{n}"]],
                        "rawMinusExpanding_priorMeets": (E[f"praw_{o}_r{n}"] - E[f"pexp_{o}"]).rename("dev").to_frame()}.items():
            X = pd.concat([lp, F], axis=1); mdl = LogisticRegression(C=1e4, max_iter=1000).fit(X[tr], y[tr.values])
            diff = ll(y[te.values], mdl.predict_proba(X[te])[:, 1]) - base
            out[f"N{n}_{name}"] = {"dLogloss": float(diff.mean()), "ci95": boot_day(diff, E.loc[te, "race_date"].values), "coef": float(mdl.coef_[0][1])}
    res["q"][o] = out
json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
print(res["population"])
for o, v in res["q"].items():
    print(o, round(v["baseLogloss"], 5))
    for k, x in v.items():
        if k != "baseLogloss": print("  ", k, "%.5f" % x["dLogloss"], ["%.5f" % c for c in x["ci95"]], "%.2f" % x["coef"])
