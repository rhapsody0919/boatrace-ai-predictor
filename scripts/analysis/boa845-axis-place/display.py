"""BOA-845 見せ方の案ごとの数字（見せる側のレース 既定 10/8〜10/11 ×軸 w=2〜6×相手 j の5艇、母集団は pool.pkl の全部）。
各案で: 軸の件数 n の帯、相手ごとの2着・3着の率の 95% 区間（Wilson）の半幅、
無条件の率が区間の外に出る割合（画面の相手レンズの値そのまま＝raw、w を除いて割り直した値＝renorm）。
差が本当に無ければ外に出るのは約5%
出力: work/display.pkl、data/analysis/boa845-axis-place/display.json"""
import numpy as np, pandas as pd
from common import *

pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
pool = load_pool()
T, tmeta = load_today()
tabs = {s: cond_table(pool, COND_KEYS[s]) for s in ["own_VC", "own_NC", "NB", "VA", "NA"]}
vcn = pool.groupby(["venue_code", "combo", "c1"], observed=True).size().to_dict()
unc = {}
for j in range(1, 7):
    for k, g in pool.groupby(["combo", f"c{j}"], observed=True):
        unc[("NC", k[0], j, k[1])] = (len(g), (g.rank2 == j).sum(), (g.rank3 == j).sum())
    for k, g in pool.groupby(["venue_code", "combo", f"c{j}"], observed=True):
        unc[("VC", k[0], k[1], j, k[2])] = (len(g), (g.rank2 == j).sum(), (g.rank3 == j).sum())

def get(s, r, w):
    v = tabs[s].get(key_for(s, r, w))
    return v if v else (0, np.zeros(6, int), np.zeros(6, int))

OPTS = ["own_default", "own_NC", "ladder30", "ladder100", "VA", "NA"]
recs = []
for r in T:
    kind = "VC" if vcn.get((r["venue_code"], r["combo"], r["c1"]), 0) >= 300 else "NC"
    for w in range(2, 7):
        v = {"own_default": get("own_VC" if kind == "VC" else "own_NC", r, w), "own_NC": get("own_NC", r, w),
             "NB": get("NB", r, w), "VA": get("VA", r, w), "NA": get("NA", r, w)}
        for T_ in (30, 100):
            v[f"ladder{T_}"] = v["own_default"] if v["own_default"][0] >= T_ else v["own_NC"] if v["own_NC"][0] >= T_ else v["NB"]
        n_own = v["own_default"][0]
        for pos in (2, 3):
            # 無条件（画面の相手レンズの値）: 相手 j の「構成＋j の級」の範囲（種類は1号艇の範囲と同じ）
            raw = np.zeros(6)
            for j in range(1, 7):
                key = ("VC", r["venue_code"], r["combo"], j, r[f"c{j}"]) if kind == "VC" else ("NC", r["combo"], j, r[f"c{j}"])
                n_, c2, c3 = unc.get(key, (0, 0, 0))
                raw[j - 1] = (c2 if pos == 2 else c3) / n_ if n_ else np.nan
            ren = raw.copy(); ren[w - 1] = 0; ren = ren / np.nansum(ren)
            for o in OPTS:
                n, c2, c3 = v[o]
                c = c2 if pos == 2 else c3
                for j in range(1, 7):
                    if j == w: continue
                    if n == 0:
                        recs.append({"opt": o, "pos": pos, "w": w, "j": j, "n": 0, "n_own": n_own}); continue
                    lo, hi = wilson_half(c[j - 1], n)
                    p = c[j - 1] / n
                    recs.append({"opt": o, "pos": pos, "w": w, "j": j, "n": n, "n_own": n_own, "p": p, "half": (hi - lo) / 2,
                                 "raw_out": not (lo <= raw[j - 1] <= hi), "ren_out": not (lo <= ren[j - 1] <= hi),
                                 "diff_ren": p - ren[j - 1], "diff_raw": p - raw[j - 1]})
X = pd.DataFrame(recs)
X["band"] = pd.cut(X.n_own, [-1, 29, 99, 299, 1e9], labels=["軸の範囲<30", "30-99", "100-299", "300+"])
X.to_pickle(WORK / "display.pkl")
res = {"pool": pool_meta(pool), "today": {**tmeta, "races": len(T)},
       "options": {"own_default": "既定の範囲（VC か NC）", "own_NC": "構成×軸の級", "ladder30": "own_default→own_NC→NB を件数30以上の最初",
                   "ladder100": "同じく件数100以上の最初", "VA": "会場で軸が1着", "NA": "全国で軸が1着"},
       "note": "セル=レース×軸×相手。半幅=Wilson 95%区間の半分(pt)。外raw/外renorm=無条件の率が区間の外に出る割合(%)。差が無ければ約5%"}
for pos in (2, 3):
    x = X[X.pos == pos]
    print(f"\n==== {pos}着（セル＝レース×軸×相手、{len(x)//len(OPTS)} セル/案）")
    g = x.groupby(["opt", "band"], observed=True)
    t = pd.DataFrame({"セル": g.size(), "n中央値": g.n.median(), "半幅中央値pt": g.half.median() * 100,
                      "半幅90%点pt": g.half.quantile(.9) * 100, "外raw%": g.raw_out.mean() * 100, "外renorm%": g.ren_out.mean() * 100,
                      "|差renorm|中央値pt": g.diff_ren.apply(lambda s: s.abs().median()) * 100})
    print(t.round(1))
    g = x.groupby("opt")
    t2 = pd.DataFrame({"半幅中央値pt": g.half.median() * 100, "外raw%": g.raw_out.mean() * 100, "外renorm%": g.ren_out.mean() * 100,
                       "|差renorm|中央値pt": g.diff_ren.apply(lambda s: s.abs().median()) * 100})
    print(t2.round(1))
    res[f"{pos}着"] = {"by_option_band": {f"{o} {b}": row for (o, b), row in t.round(1).iterrows()}, "by_option": t2.round(1)}
# 区間の半幅の目安（p=0.2・0.35）
res["half_width_guide_pt"] = {n: {p: round(float((wilson_half(p*n, n)[1]-wilson_half(p*n, n)[0])/2*100), 1) for p in (.2, .35)} for n in (10, 30, 50, 100, 300, 1000)}
print("\n半幅の目安（95%、Wilson）: ", {n: list(v.values()) for n, v in res["half_width_guide_pt"].items()})
dump("display", res)
