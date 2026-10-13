"""BOA-822 第3回の比較（項目1〜4）。入力: c2_round3.csv（本回）、ds-round1/races.pkl・analyze.py の関数、ds-round1/c2.csv（本番 snapshot）"""
import json, os
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
HERE = Path(__file__).parent; R1 = HERE.parent / "round1"
os.chdir(R1)
exec(open("analyze.py").read().split("out = {}")[0].replace("S = Path(__file__).parent", "S = R1"))
os.chdir(HERE)
sys_edges = (-1.91, -1.14, -0.49, 0.19)
res = {}
c3r = pd.read_csv("c2_round3.csv")

# ---- (b) 勝率差の帯ごとの全国の非1着率（前日まで）。帯は v16 の5帯と、0.5刻み
def band5(g): return np.select([g < sys_edges[0], g < sys_edges[1], g < sys_edges[2], g < sys_edges[3]], [0, 1, 2, 3], 4)
R["gb5"] = np.where(R.gap.notna(), band5(R.gap.round(2)), -1)
R["gb05"] = np.where(R.gap.notna(), np.clip(np.floor(R.gap / 0.5), -8, 6), -99)
def band_rate(col):
    a = R.groupby([col, "date"]).agg(n=("y", "size"), k=("y", "sum")).reset_index().sort_values([col, "date"])
    a["cn"] = a.groupby(col)["n"].cumsum() - a["n"]; a["ck"] = a.groupby(col)["k"].cumsum() - a["k"]
    m = R[[col, "date"]].reset_index().merge(a[[col, "date", "cn", "ck"]], on=[col, "date"], how="left").set_index("index")
    return (m.ck / m.cn.where(m.cn > 0)).reindex(R.index)
R["B5"] = band_rate("gb5"); R["B05"] = band_rate("gb05")
trL = R[R.date < "2025-06-01"]
D = R.merge(c3r.rename(columns={"race_id": "race_id_s"}), on="race_id_s", how="inner")
D["C3"], _ = fit_predict(trL, D); D["C3x"], _ = fit_predict(trL, D, exh=True)
D["C1f"] = D.C1.fillna(trL.y.mean())
for c in ("B5", "B05"):
    D[c] = D[c].fillna(trL.y.mean())
D = D[D.C2.notna()].copy()
# 第2回と同じ抽出（日ごとに8R、rng 5）を in_sample の中で作り直す
Ds = D[D.in_sample]
rng = np.random.default_rng(5); strat = []
for d, g in Ds.groupby("date"):
    strat += list(rng.choice(g.index, min(8, len(g)), replace=False))
D["strat"] = D.index.isin(strat)
A = D[D.strat].copy(); B = D[D.in_sample & (D.date >= "2026-09-22")].copy()
res["sets"] = {"A_strat": int(len(A)), "B_0922_1010": int(len(B)), "all_rows": int(len(D))}

def overlap(d, a, b, q=0.1, top=True):
    k = int(round(len(d) * q))
    ia = set((d[a].rank(method="first", ascending=not top)).nsmallest(k).index)
    ib = set((d[b].rank(method="first", ascending=not top)).nsmallest(k).index)
    return round(len(ia & ib) / k, 3)
def proxy_table(d, label):
    out = {}
    for c in ("C2", "B5", "B05", "C1f", "C3"):
        m = metrics(d.y, d[c])
        out[c] = {k: m[k] for k in ("n", "auc", "brier", "top10", "bot10", "cal_maxgap")}
        if c != "C2":
            diff = (d[c] - d.C2) * 100
            out[c] |= {"spearman_vs_C2": round(float(spearmanr(d[c], d.C2)[0]), 3),
                       "top10_overlap_vs_C2": overlap(d, c, "C2"), "bot10_overlap_vs_C2": overlap(d, c, "C2", top=False),
                       "change_pt_abs_quantiles(p50,p75,p90,p99)": [round(float(np.percentile(diff.abs(), p)), 1) for p in (50, 75, 90, 99)],
                       "change_pt_signed_mean": round(float(diff.mean()), 2),
                       "share_abs_gt5pt": round(float((diff.abs() > 5).mean()), 3), "share_abs_gt10pt": round(float((diff.abs() > 10).mean()), 3),
                       "boot_auc_minus_C2": boot_diff(d, c, "C2"), "boot_brier_minus_C2": boot_diff(d, c, "C2", kind="brier")}
    return out
res["item1_A"] = proxy_table(A, "A"); res["item1_B"] = proxy_table(B, "B")
# 帯の段の入れ替わり（B05 → C2 で、項目4の推奨の段がまたぐ割合）は項目4の後で

# ---- 項目2: 層が400件未満
Sm = D[(D.n_layer < 400) & (D.date >= "2025-06-01")].copy()
lc = pd.read_csv("layer_counts.csv")
res["item2"] = {"period_races": int(len(lc)), "share_lt400_allraces": round(float((lc.n_layer_count < 400).mean()), 4),
                "n_rebuilt": int(len(Sm)),
                "by_round": Sm["round"].fillna("none").value_counts().to_dict(),
                "by_grade": Sm["grade"].fillna("none").value_counts().to_dict()}
allp = R[(R.date >= "2025-06-01") & (R.date <= "2026-10-10")].merge(lc.rename(columns={"race_id": "race_id_s"}), on="race_id_s")
allp["small"] = allp.n_layer_count < 400
res["item2"]["share_small_by_round"] = allp.groupby(allp["round"].fillna("none")).small.agg(["mean", "size"]).round(3).to_dict("index")
res["item2"]["share_small_by_grade"] = allp.groupby(allp["grade"].fillna("none")).small.agg(["mean", "size"]).round(3).to_dict("index")
res["item2"]["n_layer_quantiles_small"] = Sm.n_layer.quantile([.1, .25, .5, .75]).round(0).to_dict()
for c in ("C2", "C3", "B05", "C1f"):
    res["item2"][c] = {k: v for k, v in metrics(Sm.y, Sm[c]).items() if k in ("n", "auc", "brier", "top10", "bot10", "cal_maxgap", "dec_pred", "dec_obs")}
res["item2"]["boot_auc_C2-C3"] = boot_diff(Sm, "C2", "C3"); res["item2"]["boot_brier_C2-C3"] = boot_diff(Sm, "C2", "C3", kind="brier")
Sm["k"] = Sm.n - Sm.b1win_rc
fit = Sm[Sm.date <= "2025-12-02"]; ev = Sm[Sm.date >= "2025-12-03"].copy()
shr = {}
for prior in ("base", "B05", "C3"):
    pf = pd.Series(trL.y.mean(), index=fit.index) if prior == "base" else fit[prior]
    grid = [0, 10, 25, 50, 100, 200, 400]
    br = {m: round(float(np.mean(((fit.k + m * pf) / (fit.n + m) - fit.y) ** 2)), 5) for m in grid}
    best = min(br, key=br.get)
    pe = pd.Series(trL.y.mean(), index=ev.index) if prior == "base" else ev[prior]
    ev["S"] = (ev.k + best * pe) / (ev.n + best)
    shr[prior] = {"fit_n": int(len(fit)), "eval_n": int(len(ev)), "fit_brier_by_m": br, "m_best": best,
                  "eval_brier": round(float(np.mean((ev.S - ev.y) ** 2)), 5), "eval_brier_raw": round(float(np.mean((ev.C2 - ev.y) ** 2)), 5),
                  "eval_auc": round(roc_auc_score(ev.y, ev.S), 4), "eval_auc_raw": round(roc_auc_score(ev.y, ev.C2), 4),
                  "boot_brier_shrunk-raw": boot_diff(ev, "S", "C2", kind="brier")}
res["item2"]["shrink"] = shr

# ---- 項目3: 展示後の C2
snap = pd.read_csv(R1 / "c2.csv"); se = snap[snap.stage == "exhibition"].assign(C2e_snap=lambda x: 1 - x.b1win / x.n)
mm = D[["race_id_s", "C2e", "n_layer"]].merge(se.rename(columns={"race_id": "race_id_s"}), on="race_id_s")
res["item3_repro_vs_snapshot"] = {"n": int(len(mm)), "mean_abs_diff": round(float((mm.C2e - mm.C2e_snap).abs().mean()), 4),
                                  "p95_abs_diff": round(float((mm.C2e - mm.C2e_snap).abs().quantile(.95)), 4),
                                  "max_abs_diff": round(float((mm.C2e - mm.C2e_snap).abs().max()), 4)}
for nm, d in (("A", A), ("B", B), ("A_exh_ok", A[A.exh_ok]), ("A_2025-12-03~", A[A.date >= "2025-12-03"])):
    r = {}
    for c in ("C2", "C2e", "C3", "C3x"):
        r[c] = {k: v for k, v in metrics(d.y, d[c]).items() if k in ("n", "auc", "brier", "top10", "bot10", "cal_maxgap")}
    r["boot_auc_C2e-C2"] = boot_diff(d, "C2e", "C2"); r["boot_brier_C2e-C2"] = boot_diff(d, "C2e", "C2", kind="brier")
    r["boot_auc_C2e-C3x"] = boot_diff(d, "C2e", "C3x"); r["boot_auc_C2e-C3"] = boot_diff(d, "C2e", "C3")
    r["change_pt_abs_quantiles(p50,p90,p99)"] = [round(float(np.percentile((d.C2e - d.C2).abs() * 100, p)), 1) for p in (50, 90, 99)]
    res[f"item3_{nm}"] = r
res["item3_exh_missing_share_period"] = {"A": round(float(1 - A.exh_ok.mean()), 4), "B": round(float(1 - B.exh_ok.mean()), 4)}

# ---- 項目4: 段の切り方
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]
schemes = {"5段_10pt刻み(35/45/55/65)": [0.35, 0.45, 0.55, 0.65], "3段(35/55)": [0.35, 0.55], "4段(30/45/60)": [0.30, 0.45, 0.60],
           "5段(25/35/55/65)": [0.25, 0.35, 0.55, 0.65], "4段(35/45/55)": [0.35, 0.45, 0.55]}
item4 = {}
for nm, d in (("A_long", A), ("B_0922_1010", B)):
    item4[nm] = {}
    for sn, edges in schemes.items():
        b = np.digitize(d.C2, edges)
        rows = []
        for j in range(len(edges) + 1):
            x = d[b == j]
            if len(x) == 0:
                rows.append({"band": j, "n": 0}); continue
            rows.append({"band": j, "range": f"{([0]+edges)[j]:.2f}-{(edges+[1])[j]:.2f}", "n": int(len(x)), "share": round(len(x) / len(d), 3),
                         "pred_mean": round(float(x.C2.mean()), 3), "obs": round(float(x.y.mean()), 3), "wilson95": wilson(x.y.sum(), len(x))})
        item4[nm][sn] = rows
res["item4"] = item4
# 推奨の段（4段 35/45/55）で、朝の (b) B05 → C2 で段がまたぐ割合
for nm, d in (("A", A), ("B", B)):
    e = [0.35, 0.45, 0.55]
    res.setdefault("item1_band_switch_4band", {})[nm] = {
        "B05": round(float((np.digitize(d.B05, e) != np.digitize(d.C2, e)).mean()), 3),
        "C1f": round(float((np.digitize(d.C1f, e) != np.digitize(d.C2, e)).mean()), 3),
        "C3": round(float((np.digitize(d.C3, e) != np.digitize(d.C2, e)).mean()), 3),
        "C2e(展示後)": round(float((np.digitize(d.C2e, e) != np.digitize(d.C2, e)).mean()), 3),
        "B05_jump2plus": round(float((np.abs(np.digitize(d.B05, e) - np.digitize(d.C2, e)) >= 2).mean()), 3)}
json.dump(res, open("result3.json", "w"), ensure_ascii=False, indent=1, default=str)
print("ok")
