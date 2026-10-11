"""BOA-845 追加: 今ある1号艇の範囲の scenario（3連単 tri を持つ）で winFollowers(scenario, w) をそのまま使った場合
（b1_default = 1号艇の VC、300件未満なら NC）の件数と、時系列の検証の Brier（effect.py と同じ学習・検証の分け方）
入力: work/today_counts.pkl・pool.pkl。出力: data/analysis/boa845-axis-place/b1scope.json"""
import numpy as np, pandas as pd
from common import *

R = pd.read_pickle(WORK / "today_counts.pkl")
R["b1_default"] = np.where(R.default_kind == "VC", R.b1_VC, R.b1_NC)
A = R[R.w >= 2]
s = lambda x: {"中央値": x.median(), "10%点": x.quantile(.1), "<30%": round((x < 30).mean() * 100, 1), "<100%": round((x < 100).mean() * 100, 1)}
res = {"today_b1_default": s(A.b1_default)}
print("today b1_default 全体", res["today_b1_default"])
res["today_b1_default_by_boat"] = A.groupby("w").b1_default.apply(lambda x: pd.Series(s(x))).unstack()
print(res["today_b1_default_by_boat"])
pool = load_pool()
res["pool"] = pool_meta(pool)
tr, te = pool[pool.race_date <= CUT], pool[(pool.race_date > CUT) & (pool.rank1 >= 2)]
tb = {s_: cond_table(tr, COND_KEYS[s_]) for s_ in ["b1_VC", "b1_NC", "NA"]}
vcn = tr.groupby(["venue_code", "combo", "c1"], observed=True).size().to_dict()
out = []
for r in te.to_dict("records"):
    w = r["rank1"]; kind = "VC" if vcn.get((r["venue_code"], r["combo"], r["c1"]), 0) >= 300 else "NC"
    for pos in (2, 3):
        y = np.eye(6)[r[f"rank{pos}"] - 1]
        P = {}
        for s_ in tb:
            v = tb[s_].get(key_for(s_, r, w))
            if v and v[0]:
                c = (v[1] if pos == 2 else v[2]).astype(float); c[w - 1] = 0; P[s_] = (c / c.sum(), v[0])
        na = P["NA"][0]
        p, n = P.get("b1_VC" if kind == "VC" else "b1_NC", (na, 0))
        out.append({"pos": pos, "n": n, "B_b1": ((p - y) ** 2).sum(), "B_NA": ((na - y) ** 2).sum()})
O = pd.DataFrame(out); O["band"] = pd.cut(O.n, [-1, 29, 99, 299, 1e9], labels=["<30", "30-99", "100-299", "300+"])
t = O.groupby(["pos", "band"], observed=True)[["B_b1", "B_NA"]].agg(["mean", "size"]).round(4)
print(t)
res["timesplit_by_band"] = {f"{p}着 {b}": {"B_b1": row[("B_b1", "mean")], "B_NA": row[("B_NA", "mean")], "件数": row[("B_b1", "size")]}
                            for (p, b), row in t.iterrows()}
t2 = O.groupby("pos")[["B_b1", "B_NA"]].mean().round(4)
print(t2)
res["timesplit_all"] = {f"{p}着": row for p, row in t2.iterrows()}
dump("b1scope", res)
