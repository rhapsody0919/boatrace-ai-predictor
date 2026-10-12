"""BOA-845 案C の印のルールの検証（思考アシストの相手レンズ「X号艇を軸にしたときの2着」）。
範囲は会場の全レース（VA）。p = 会場で X が1着のレースでの j の2着率、q = 会場の全レースでの j の2着率を X を除いて合計100%に割り直した値。
印: p − q ≥ +5pt で ↑多め、≤ −5pt で ↓少なめ（案C、docs/design/thinking-assist/boa831/fan-panel-boa845-q3.md）。
(1) 基準 q の性質: #1407 の時系列の検証の「無条件」(base_unc) との違い、別の基準 q_nw（j が1着でないレースでの2着率を割り直し）
(2) ノイズ: 件数ごとの区間の半幅・差が無いときに印が点く割合（二項分布の厳密計算）、24会場×軸5艇×相手5艇の印の数と区間が q をまたぐ数
(3) 時系列: 学習（〜CUT）で印を決め、検証（CUT翌日〜）で p − q（q は学習の値）の向きが当たるか。分割は2通り
(4) ルールの案ごとの印の数と当たり方
母集団は pool.pkl（build_pool.py の出力）。会場の全レースは級が欠けたレースも含める（API の scope=VA と同じ。load_pool は使わない）
出力: data/analysis/boa845-axis-place/mark-rule.json（環境変数 MARK_RULE_OUT で変更可）"""
import json, os, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import binom, norm
from common import WORK, OUT_DIR, wilson_half, _jsonable

pool = pd.read_pickle(WORK / "pool.pkl")
pool["race_date"] = pd.to_datetime(pool["race_date"])
pool["venue_code"] = pool["venue_code"].astype(int)
TH = 0.05
SPLITS = [("2026-03-31", "#1407 と同じ分割（検証6か月）"), ("2023-09-30", "検証3年（件数を増やした分割）")]


def cells(p):
    """会場×軸 X(2〜6)×相手 j の n・k・q・q_nw・全国の差 d_nat"""
    out = []
    nat_r2 = np.array([(p.rank2 == j).mean() for j in range(1, 7)])
    for v, g in p.groupby("venue_code"):
        r2 = np.array([(g.rank2 == j).mean() for j in range(1, 7)])
        nw = np.array([((g.rank2 == j) & (g.rank1 != j)).sum() / max((g.rank1 != j).sum(), 1) for j in range(1, 7)])
        for X in range(2, 7):
            gx = g[g.rank1 == X]
            n = len(gx)
            k = np.bincount(gx.rank2, minlength=7)[1:]
            q = r2.copy(); q[X - 1] = 0; q /= q.sum()
            qn = nw.copy(); qn[X - 1] = 0; qn /= qn.sum()
            gn = p[p.rank1 == X]
            pn = np.bincount(gn.rank2, minlength=7)[1:] / len(gn)
            qnat = nat_r2.copy(); qnat[X - 1] = 0; qnat /= qnat.sum()
            for j in range(1, 7):
                if j == X: continue
                out.append({"venue": v, "X": X, "j": j, "n": n, "k": int(k[j - 1]), "q": q[j - 1], "q_nw": qn[j - 1],
                            "d_nat": pn[j - 1] - qnat[j - 1]})
    c = pd.DataFrame(out)
    c["p"] = c.k / c.n
    c["d"] = c.p - c.q
    c["lo95"], c["hi95"] = wilson_half(c.k, c.n)
    c["lo99"], c["hi99"] = wilson_half(c.k, c.n, z=2.576)
    c["half95"] = (c.hi95 - c.lo95) / 2
    c["se"] = np.sqrt(c.q * (1 - c.q) / c.n)
    return c


def fp_null(n, q, th=TH):
    """真の2着率が q（差なし）のとき、|k/n − q| ≥ th になる確率（二項分布の厳密値）"""
    n = int(n)
    hi = np.ceil(n * (q + th) - 1e-9); lo = np.floor(n * (q - th) + 1e-9)
    return float(binom.sf(hi - 1, n, q) + binom.cdf(lo, n, q))


def power(n, q, true_d, th=TH):
    """真の差が true_d のとき、同じ向きの印が点く確率"""
    n = int(n); pt = q + true_d
    if true_d >= 0:
        return float(binom.sf(np.ceil(n * (q + th) - 1e-9) - 1, n, pt))
    return float(binom.cdf(np.floor(n * (q - th) + 1e-9), n, pt))


RULES = {
    "C_5pt": lambda c: c.d.abs() >= TH,
    "C_5pt_ci95": lambda c: (c.d.abs() >= TH) & ((c.q < c.lo95) | (c.q > c.hi95)),
    "C_5pt_ci99": lambda c: (c.d.abs() >= TH) & ((c.q < c.lo99) | (c.q > c.hi99)),
    "C_5pt_n500": lambda c: (c.d.abs() >= TH) & (c.n >= 500),
    "C_3pt_ci95": lambda c: (c.d.abs() >= 0.03) & ((c.q < c.lo95) | (c.q > c.hi95)),
    "C_8pt": lambda c: c.d.abs() >= 0.08,
    "NW_5pt": lambda c: (c.p - c.q_nw).abs() >= TH,
}
RULE_NOTE = {"C_5pt": "|p−q|≥5pt（案C）", "C_5pt_ci95": "|p−q|≥5pt かつ 95%区間が q をまたがない",
             "C_5pt_ci99": "|p−q|≥5pt かつ 99%区間が q をまたがない", "C_5pt_n500": "|p−q|≥5pt かつ件数500以上",
             "C_3pt_ci95": "|p−q|≥3pt かつ 95%区間が q をまたがない", "C_8pt": "|p−q|≥8pt", "NW_5pt": "|p−q_nw|≥5pt（基準を q_nw に変えた案。向きも q_nw で判定）"}

res = {"generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds"),
       "pool": {"races": len(pool), "from": str(pool.race_date.min().date()), "to": str(pool.race_date.max().date()),
                "note": "pool.pkl（2026-10-01 時点の書き出し、タブ3の母集団と同じ条件）。会場の全レースは級の欠けたレースも含む"},
       "definition": {"p": "会場で X が1着のレースでの j の2着率", "q": "会場の全レースでの j の2着率を X を除いて合計100%に割り直した値（案C）",
                      "q_nw": "会場で j が1着でないレースでの j の2着率を X を除いて割り直した値（比べた別の基準）",
                      "base_unc_1407": "#1407 の時系列の検証の無条件: 相手 j の『構成×j の級』（会場×構成 300件以上なら会場も）の2着率を X を除いて割り直した値"}}

# ---------- (1)(2) 全期間
C = cells(pool)
print("cells", len(C), "n min", C.n.min(), "n 10%点", C.groupby(["venue", "X"]).n.first().quantile(.1))
C["fp"] = [fp_null(n, q) for n, q in zip(C.n, C.q)]
for name, f in RULES.items():
    C[f"m_{name}"] = f(C)
C["straddle95"] = (C.q >= C.lo95) & (C.q <= C.hi95)
C["d_nw"] = C.p - C.q_nw
m = C.m_C_5pt
full = {"cells": len(C), "venue_axis": int(C.groupby(["venue", "X"]).ngroups),
        "n_axis": C.groupby(["venue", "X"]).n.first().describe(percentiles=[.1, .5]).round(1).to_dict(),
        "marks_C": {"total": int(m.sum()), "up": int((m & (C.d > 0)).sum()), "down": int((m & (C.d < 0)).sum()),
                    "straddle95_among_marked": int((m & C.straddle95).sum()),
                    "straddle99_among_marked": int((m & ~C.m_C_5pt_ci99).sum()),
                    "expected_false_if_all_null": round(float(C.fp.sum()), 2),
                    "fp_max_cell": round(float(C.fp.max()), 4)},
        "half95_pt_by_X": (C.groupby("X").half95.median() * 100).round(2).to_dict(),
        "marks_by_X_j": C[m].assign(s=np.sign(C.d[m])).groupby(["X", "j"]).s.agg(["size", "sum"]).rename(columns={"size": "marks", "sum": "up_minus_down"}).reset_index().to_dict("records"),
        "same_sign_as_national_among_marked": round(float((np.sign(C.d[m]) == np.sign(C.d_nat[m])).mean() * 100), 1),
        "marks_by_rule": {k: int(C[f"m_{k}"].sum()) for k in RULES},
        "baseline_q_nw": {"marks": int((C.d_nw.abs() >= TH).sum()),
                          "boat1_marks_q": {"up": int(((C.j == 1) & m & (C.d > 0)).sum()), "down": int(((C.j == 1) & m & (C.d < 0)).sum())},
                          "boat1_marks_q_nw": {"up": int(((C.j == 1) & (C.d_nw >= TH)).sum()), "down": int(((C.j == 1) & (C.d_nw <= -TH)).sum())},
                          "boat1_d_median_pt": {"q": round(float(C[C.j == 1].d.median() * 100), 1), "q_nw": round(float(C[C.j == 1].d_nw.median() * 100), 1)},
                          "agree_marks": int(((np.sign(C.d) * (C.d.abs() >= TH)) == (np.sign(C.d_nw) * (C.d_nw.abs() >= TH))).sum())}}
print(json.dumps(_jsonable(full), ensure_ascii=False)[:3000])
# 例: 徳山 X=4
print(C[(C.venue == 18) & (C.X == 4)][["j", "n", "p", "q", "q_nw", "d", "d_nw", "lo95", "hi95"]].round(3))

# 件数ごとの目安
guide = []
for n in (342, 400, 527, 1000, 1698, 2366):
    for q in (0.08, 0.15, 0.20, 0.30, 0.35):
        lo, hi = wilson_half(q * n, n)
        guide.append({"n": n, "q": q, "half95_pt": (hi - lo) / 2 * 100, "fp_null_pct": fp_null(n, q) * 100,
                      "fp_null_one_side_pct": fp_null(n, q) * 50,
                      "power_true5pt_pct": power(n, q, 0.05) * 100, "power_true3pt_pct": power(n, q, 0.03) * 100,
                      "power_true8pt_pct": power(n, q, 0.08) * 100})
G = pd.DataFrame(guide).round(2)
print(G.to_string())
full["guide_by_n"] = G.to_dict("records")
res["full_period"] = full

# 境界付近の数（真の差が 5pt 前後だと点いたり消えたりする）
nb = C[(C.d.abs() >= 0.03) & (C.d.abs() < 0.07)]
full["near_threshold_3to7pt"] = {"cells": len(nb), "marked": int(nb.m_C_5pt.sum())}

# ---------- (3)(4) 時系列
res["timesplit"] = {}
for cut, note in SPLITS:
    cut = pd.Timestamp(cut)
    tr, te = pool[pool.race_date <= cut], pool[pool.race_date > cut]
    A = cells(tr)
    B = cells(te)[["venue", "X", "j", "n", "k", "q"]].rename(columns={"n": "n_te", "k": "k_te", "q": "q_te"})
    A = A.merge(B, on=["venue", "X", "j"])
    A["p_te"] = A.k_te / A.n_te
    A["d_te"] = A.p_te - A.q  # q は学習の値（未来の情報を使わない）
    out = {"note": note, "train": [str(tr.race_date.min().date()), str(cut.date()), len(tr)],
           "test": [str((cut + pd.Timedelta(days=1)).date()), str(te.race_date.max().date()), len(te)],
           "n_te_axis_median": float(A.groupby(["venue", "X"]).n_te.first().median()),
           "n_te_axis_min": int(A.n_te.min()), "rules": {}}
    # 予測としての当たり: 会場の差 d と全国の差 d_nat のどちらが検証の差に近いか（件数で重み）
    w = A.n_te
    out["mse_test_diff_pt2"] = {"venue_d": float(np.average((A.d_te - A.d) ** 2, weights=w) * 1e4),
                                "national_d": float(np.average((A.d_te - A.d_nat) ** 2, weights=w) * 1e4),
                                "zero": float(np.average(A.d_te ** 2, weights=w) * 1e4)}
    A["d_nw_te"] = A.p_te - A.q_nw
    for name, f in RULES.items():
        mk = f(A)
        if name.startswith("NW"):
            A_ = A.assign(d=A.p - A.q_nw, d_te=A.d_nw_te, q=A.q_nw)
        else:
            A_ = A
        x = A_[mk]
        hit = (np.sign(x.d_te) == np.sign(x.d))
        up, dn = x[x.d > 0], x[x.d < 0]
        # 検証の件数の揺れだけで向きが外れる割合の目安（学習の差を真とみなしたとき）
        exp_hit = float(np.mean([1 - norm.cdf(-abs(d) / np.sqrt(max(q * (1 - q), 1e-6) / nt)) for d, q, nt in zip(x.d, x.q, x.n_te)])) if len(x) else None
        nm = A_[~mk]
        r = {"marks": int(mk.sum()), "up": len(up), "down": len(dn),
             "sign_hit_pct": round(float(hit.mean() * 100), 1) if len(x) else None,
             "sign_hit_expected_by_test_noise_pct": round(exp_hit * 100, 1) if exp_hit else None,
             "up_test_rate_vs_q_pt": round(float((up.k_te.sum() / up.n_te.sum() - np.average(up.q, weights=up.n_te)) * 100), 2) if len(up) else None,
             "down_test_rate_vs_q_pt": round(float((dn.k_te.sum() / dn.n_te.sum() - np.average(dn.q, weights=dn.n_te)) * 100), 2) if len(dn) else None,
             "up_test_ge5_pct": round(float((up.d_te >= TH).mean() * 100), 1) if len(up) else None,
             "down_test_le5_pct": round(float((dn.d_te <= -TH).mean() * 100), 1) if len(dn) else None,
             "unmarked_test_abs_d_mean_pt": round(float(np.average(nm.d_te.abs(), weights=nm.n_te) * 100), 2) if len(nm) else None,
             "flip_cells": int((~hit).sum()) if len(x) else 0}
        # 全国と向きが違う会場固有の印
        own = x[np.sign(x.d) != np.sign(x.d_nat)]
        r["against_national"] = {"marks": len(own), "sign_hit_pct": round(float((np.sign(own.d_te) == np.sign(own.d)).mean() * 100), 1) if len(own) else None}
        out["rules"][name] = r
    # 学習の差の大きさの帯ごと
    A["band"] = pd.cut(A.d.abs() * 100, [0, 3, 5, 8, 12, 100], right=False)
    out["by_train_abs_d_pt"] = A.groupby("band", observed=True).apply(lambda g: pd.Series({
        "cells": len(g), "sign_hit_pct": round(float((np.sign(g.d_te) == np.sign(g.d)).mean() * 100), 1),
        "test_d_over_train_d": round(float(np.average(g.d_te * np.sign(g.d), weights=g.n_te) / np.average(g.d.abs(), weights=g.n_te)), 2)})).to_dict("index")
    print("\n==", note, out["train"], out["test"]); print(json.dumps(_jsonable(out), ensure_ascii=False, indent=0)[:4000])
    res["timesplit"][str(cut.date())] = out

# ---------- (5) 基準の比較
C["d_nw"] = C.p - C.q_nw
mk_nw = C.d_nw.abs() >= TH
res["baseline_compare"] = {
    "mse_vs_p_pt2": {"q": float(np.average(C.d ** 2, weights=C.n) * 1e4), "q_nw": float(np.average(C.d_nw ** 2, weights=C.n) * 1e4)},
    "marks_by_j": {"q": C[C.m_C_5pt].assign(s=np.sign(C.d)).groupby("j").s.agg(up=lambda s: int((s > 0).sum()), down=lambda s: int((s < 0).sum())).to_dict("index"),
                   "q_nw": C[mk_nw].assign(s=np.sign(C.d_nw)).groupby("j").s.agg(up=lambda s: int((s > 0).sum()), down=lambda s: int((s < 0).sum())).to_dict("index")},
    "marks_by_X_j_q_nw": C[mk_nw].assign(s=np.sign(C.d_nw)).groupby(["X", "j"]).s.agg(["size", "sum"]).rename(columns={"size": "marks", "sum": "up_minus_down"}).reset_index().to_dict("records"),
    "marks_per_axis_mean": {"q": round(float(C.m_C_5pt.sum() / 120), 2), "q_nw": round(float(mk_nw.sum() / 120), 2)},
    "q_nw_marked_straddle95": int((mk_nw & (C.q_nw >= C.lo95) & (C.q_nw <= C.hi95)).sum()),
    "q_nw_expected_false_if_all_null": round(float(sum(fp_null(n, q) for n, q in zip(C.n, C.q_nw))), 2),
    "national_d_q_nw_pt": {}}
nat_r2 = np.array([(pool.rank2 == j).mean() for j in range(1, 7)])
nat_nw = np.array([((pool.rank2 == j) & (pool.rank1 != j)).sum() / (pool.rank1 != j).sum() for j in range(1, 7)])
for X in range(2, 7):
    g = pool[pool.rank1 == X]; pn = np.bincount(g.rank2, minlength=7)[1:] / len(g)
    for nm_, base in (("q", nat_r2), ("q_nw", nat_nw)):
        b = base.copy(); b[X - 1] = 0; b /= b.sum()
        res["baseline_compare"]["national_d_q_nw_pt"].setdefault(f"X{X}", {})[nm_] = {f"j{j}": round(float((pn[j-1] - b[j-1]) * 100), 1) for j in range(1, 7) if j != X}
# 例: 徳山（18）で4号艇が軸
res["example_tokuyama_X4"] = C[(C.venue == 18) & (C.X == 4)][["j", "n", "p", "q", "q_nw", "d", "d_nw", "lo95", "hi95"]].round(4).to_dict("records")
# #1407 の時系列の検証の無条件（base_unc）との差: 見せる側の 600R（today.json）で、会場の q とレースごとの base_unc を比べる
try:
    from common import load_today, load_pool
    T, tmeta = load_today()
    pl = load_pool()
    vcn = pl.groupby(["venue_code", "combo", "c1"], observed=True).size().to_dict()
    unc = {}
    for j in range(1, 7):
        for k, g in pl.groupby(["combo", f"c{j}"], observed=True):
            unc[("NC", k[0], j, k[1])] = (len(g), int((g.rank2 == j).sum()))
        for k, g in pl.groupby(["venue_code", "combo", f"c{j}"], observed=True):
            unc[("VC", k[0], k[1], j, k[2])] = (len(g), int((g.rank2 == j).sum()))
    qv = C.set_index(["venue", "X", "j"]).q
    diffs = []
    for r in T:
        kind = "VC" if vcn.get((r["venue_code"], r["combo"], r["c1"]), 0) >= 300 else "NC"
        raw = np.zeros(6)
        for j in range(1, 7):
            key = ("VC", r["venue_code"], r["combo"], j, r[f"c{j}"]) if kind == "VC" else ("NC", r["combo"], j, r[f"c{j}"])
            n_, c2 = unc.get(key, (0, 0)); raw[j - 1] = c2 / n_ if n_ else np.nan
        for X in range(2, 7):
            b = raw.copy(); b[X - 1] = 0; b = b / np.nansum(b)
            for j in range(1, 7):
                if j != X and not np.isnan(b[j - 1]):
                    diffs.append(qv[(r["venue_code"], X, j)] - b[j - 1])
    diffs = np.abs(np.array(diffs)) * 100
    res["baseline_compare"]["q_vs_base_unc_1407"] = {"today": tmeta, "cells": len(diffs), "abs_diff_median_pt": round(float(np.median(diffs)), 2),
                                                     "abs_diff_p90_pt": round(float(np.quantile(diffs, .9)), 2), "ge5pt_pct": round(float((diffs >= 5).mean() * 100), 1)}
except FileNotFoundError as e:
    res["baseline_compare"]["q_vs_base_unc_1407"] = f"today.json が無いので省略（{e}）"
print(json.dumps(_jsonable(res["baseline_compare"]), ensure_ascii=False, indent=0))
print(res["example_tokuyama_X4"])

# ---------- (6) 基準そのものの当たり（#1407 と同じ分割。検証は 2〜6号艇が1着のレース、1着の艇を除く5艇の2着の Brier）
cut = pd.Timestamp(SPLITS[0][0])
tr, te = pool[pool.race_date <= cut], pool[(pool.race_date > cut) & (pool.rank1 >= 2)]
A = cells(tr).set_index(["venue", "X", "j"])
recs = []
for r in te[["venue_code", "rank1", "rank2"]].itertuples(index=False):
    v, X, y = r
    row = {}
    for col in ("p", "q", "q_nw"):
        pr = np.array([A.at[(v, X, j), col] if j != X else 0.0 for j in range(1, 7)])
        oh = np.zeros(6); oh[y - 1] = 1
        row[col] = float(((pr - oh) ** 2).sum())
    recs.append(row)
Bm = pd.DataFrame(recs)
rng = np.random.default_rng(845)
idx = rng.integers(0, len(Bm), size=(2000, len(Bm)))
def ci(a, b):
    d = (Bm[a] - Bm[b]).to_numpy()
    bs = d[idx].mean(axis=1)
    return {"diff": round(float(d.mean()), 5), "ci95": [round(float(np.quantile(bs, .025)), 5), round(float(np.quantile(bs, .975)), 5)],
            "rel_pct": round(float(d.mean() / Bm[a].mean() * 100), 2)}
res["baseline_brier"] = {"test_races": len(Bm), "note": "2着の Brier（5艇）。p=会場で軸が1着のときの2着率（VA）、q・q_nw は学習期間の会場の値。差は左−右（正なら右が良い）",
                         "mean": Bm.mean().round(4).to_dict(), "q_minus_p": ci("q", "p"), "q_nw_minus_p": ci("q_nw", "p"), "q_minus_q_nw": ci("q", "q_nw")}
print(res["baseline_brier"])

res["rules"] = RULE_NOTE
dest = Path(os.environ.get("MARK_RULE_OUT", OUT_DIR / "mark-rule.json"))
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(_jsonable(res), ensure_ascii=False, indent=1) + "\n")
print("wrote", dest)
