"""BOA-845 確認3・4。
(a) 全国 NA の「w が1着のときの j の2着・3着」と、無条件の2着・3着（w を除いて割り直し）の差＝スジの効き（件数の揺れが無い大きさ）
(b) 時系列の検証: 範囲は 2019-04-01〜2026-03-31 で数え、2026-04-01〜10-01 の 2〜6号艇が1着のレースで当てる（未来の情報は使わない）
出力: work/effect_eval.pkl（boot.py が読む）、data/analysis/boa845-axis-place/effect.json"""
import numpy as np, pandas as pd
from common import *

pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
pool = load_pool()
res = {"pool": pool_meta(pool)}


def unc_tables(p):
    """各艇 j の無条件の2着・3着の件数。NC=(combo,j,cls_j)、VC=(venue,combo,j,cls_j)、NA=(j,)"""
    nc, vc = {}, {}
    for j in range(1, 7):
        for k, g in p.groupby(["combo", f"c{j}"], sort=False, observed=True):
            nc[(k[0], j, k[1])] = (len(g), int((g.rank2 == j).sum()), int((g.rank3 == j).sum()))
        for k, g in p.groupby(["venue_code", "combo", f"c{j}"], sort=False, observed=True):
            vc[(k[0], k[1], j, k[2])] = (len(g), int((g.rank2 == j).sum()), int((g.rank3 == j).sum()))
    na = {(j,): (len(p), int((p.rank2 == j).sum()), int((p.rank3 == j).sum())) for j in range(1, 7)}
    return nc, vc, na

# ---------------- (a) 全国のスジの効き
print("== (a) 全国 NA（2019-04〜2026-10-01、", len(pool), "R）: w が1着のときの j の2着率 − 無条件の2着率（w を除いて割り直し）pt")
u2 = np.array([(pool.rank2 == j).mean() for j in range(1, 7)])
u3 = np.array([(pool.rank3 == j).mean() for j in range(1, 7)])
res["a_national"] = {"note": "rate=w が1着のときの j の率(%)、diff=w を除いて割り直した無条件の率との差(pt)",
                     "uncond_rate2": u2 * 100, "uncond_rate3": u3 * 100}
for pos, u, col in (("2着", u2, "rank2"), ("3着", u3, "rank3")):
    rows, js = {}, {}
    for w in range(1, 7):
        g = pool[pool.rank1 == w]
        c = np.array([(g[col] == j).mean() for j in range(1, 7)])
        base = u.copy(); base[w - 1] = 0; base = base / base.sum()
        rows[f"{w}が1着(n={len(g)})"] = [f"{c[j]*100:.1f} ({(c[j]-base[j])*100:+.1f})" if j != w - 1 else "-" for j in range(6)]
        js[f"w{w}"] = {"n": len(g), **{f"j{j+1}": {"rate": c[j] * 100, "diff": (c[j] - base[j]) * 100} for j in range(6) if j != w - 1}}
    res["a_national"][pos] = js
    print(pos, "条件付きの率（割り直した無条件との差）"); print(pd.DataFrame(rows, index=[f"{j}号艇" for j in range(1, 7)]).T)

# ---------------- (b) 時系列の検証
tr, te = pool[pool.race_date <= CUT], pool[(pool.race_date > CUT) & (pool.rank1 >= 2)]
print("\n== (b) 学習", len(tr), "R（〜2026-03-31） / 検証", len(te), "R（2026-04-01〜10-01、2〜6号艇が1着）")
res["b_timesplit"] = {"train_races": len(tr), "train_to": str(CUT.date()), "test_races": len(te),
                      "test_from": str((CUT + pd.Timedelta(days=1)).date()), "test_to": str(te.race_date.max().date()),
                      "note": "Brier は5艇（1着の艇を除く）の二乗誤差の和。小さいほど良い。band は既定の範囲（own_default）の件数"}
tabs = {s: cond_table(tr, COND_KEYS[s]) for s in ["own_VC", "own_NC", "NB", "VA", "NA", "b1_NC"]}
nc, vc, na = unc_tables(tr)
vcn = tr.groupby(["venue_code", "combo", "c1"], observed=True).size().to_dict()

def probs(t, key, w, pos):
    v = t.get(key)
    if v is None or v[0] == 0:
        return None, 0
    c = (v[1] if pos == 2 else v[2]).astype(float)
    c[w - 1] = 0
    return c / c.sum(), v[0]

def base_probs(r, w, pos, kind):
    u = np.zeros(6)
    for j in range(1, 7):
        if j == w: continue
        key = (r["venue_code"], r["combo"], j, r[f"c{j}"]) if kind == "VC" else (r["combo"], j, r[f"c{j}"])
        n_, c2, c3 = (vc if kind == "VC" else nc).get(key, (0, 0, 0))
        u[j - 1] = ((c2 if pos == 2 else c3) + 1) / (n_ + 6)  # 0件の範囲だけ埋めるための +1
    return u / u.sum()

M = 30  # 縮小の強さ（件数 30 で半々）
recs = []
for r in te.to_dict("records"):
    w = r["rank1"]
    kind = "VC" if vcn.get((r["venue_code"], r["combo"], r["c1"]), 0) >= 300 else "NC"
    for pos in (2, 3):
        y = np.zeros(6); y[r[f"rank{pos}"] - 1] = 1
        base = base_probs(r, w, pos, kind)
        P = {"base_unc": base}
        nn = {}
        for s in tabs:
            p, n = probs(tabs[s], key_for(s, r, w), w, pos)
            P[s], nn[s] = (p if p is not None else base), n
        own = "own_VC" if kind == "VC" else "own_NC"
        P["own_default"], nn["own_default"] = P[own], nn[own]
        n0 = nn["own_default"]
        P["shrink_unc"] = (n0 * P["own_default"] + M * base) / (n0 + M)
        P["shrink_NA"] = (n0 * P["own_default"] + M * P["NA"]) / (n0 + M)
        for T in (30, 100):
            P[f"ladder{T}"] = P["own_default"] if n0 >= T else (P["own_NC"] if nn["own_NC"] >= T else P["NB"])
        rec = {"pos": pos, "w": w, "n": n0, "kind": kind}
        for k, p in P.items():
            rec[f"B_{k}"] = float(((p - y) ** 2).sum())
            rec[f"L_{k}"] = float(-np.log(max(p[r[f'rank{pos}'] - 1], 1e-3)))
            rec[f"p_{k}"] = p
        rec["y"] = r[f"rank{pos}"]
        recs.append(rec)
E = pd.DataFrame(recs)
E["band"] = pd.cut(E.n, [-1, 29, 99, 299, 1e9], labels=["<30", "30-99", "100-299", "300+"])
models = ["base_unc", "NA", "VA", "NB", "own_NC", "own_default", "shrink_unc", "shrink_NA", "ladder30", "ladder100"]
res["b_timesplit"]["models"] = {
    "base_unc": "無条件（相手 j の構成×級の2着・3着率、w を除いて割り直し）", "NA": "全国で w が1着", "VA": "会場で w が1着",
    "NB": "全国×w の級で w が1着", "own_NC": "構成×w の級で w が1着", "own_default": "既定の範囲（VC か NC）で w が1着",
    "shrink_unc": "own_default を無条件へ縮小（件数30で半々）", "shrink_NA": "own_default を NA へ縮小（件数30で半々）",
    "ladder30": "own_default→own_NC→NB を件数30以上の最初", "ladder100": "同じく件数100以上の最初"}
for pos in (2, 3):
    e = E[E.pos == pos]
    out = res["b_timesplit"][f"{pos}着"] = {}
    print(f"\n-- {pos}着: Brier（5艇、小さいほど良い）全体と軸の範囲（既定の種類）の件数の帯別。件数 {len(e)}")
    tb = e.groupby("band", observed=True)[[f"B_{m}" for m in models]].mean()
    tb.loc["全体"] = e[[f"B_{m}" for m in models]].mean()
    tb["件数"] = list(e.groupby("band", observed=True).size()) + [len(e)]
    print(tb.round(4)); out["brier_by_band"] = tb.round(4)
    print(f"-- {pos}着: log loss")
    tl = e.groupby("band", observed=True)[[f"L_{m}" for m in models]].mean(); tl.loc["全体"] = e[[f"L_{m}" for m in models]].mean()
    print(tl.round(4)); out["logloss_by_band"] = tl.round(4)
    print(f"-- {pos}着: 艇番別 Brier")
    tw = e.groupby("w")[[f"B_{m}" for m in ["base_unc", "NA", "own_default", "shrink_NA", "ladder30"]]].mean().round(4)
    print(tw); out["brier_by_boat"] = tw
    # 較正（own_default と shrink_NA）: 予測の帯ごとの実際の率
    out["calibration"] = {}
    for m in ("own_default", "shrink_NA", "base_unc"):
        pp = np.concatenate([np.delete(p, w - 1) for p, w in zip(e[f"p_{m}"], e.w)])
        yy = np.concatenate([np.delete(np.eye(6)[y - 1], w - 1) for y, w in zip(e.y, e.w)])
        bins = pd.cut(pp, [0, .05, .1, .15, .2, .3, .4, .5, 1.0], include_lowest=True)
        cal = pd.DataFrame({"p": pp, "y": yy, "b": bins}).groupby("b", observed=True).agg(予測=("p", "mean"), 実際=("y", "mean"), 件数=("y", "size"))
        cal = cal.assign(予測=cal.予測 * 100, 実際=cal.実際 * 100).round(1)
        out["calibration"][m] = cal
        print(f"   較正 {m}"); print(cal.T)
E.drop(columns=[c for c in E.columns if c.startswith("p_")]).to_pickle(WORK / "effect_eval.pkl")
dump("effect", res)
