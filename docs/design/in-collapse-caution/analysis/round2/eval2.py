"""BOA-822 第2回の比較。C2（作り直し）・C1・C3・O'・O（保存値）を同じレースで"""
import json, os
from pathlib import Path
import numpy as np, pandas as pd
HERE = Path(__file__).parent; R1 = HERE.parent / "ds-round1"
os.chdir(R1)
exec(open("analyze.py").read().split("out = {}")[0].replace("S = Path(__file__).parent", "S = R1"))  # R（第1回の候補量）と関数
os.chdir(HERE)
res = {}
# 再現: 月ごとの標準化（本番は日ごと）と日ごとの照合
a = pd.read_csv("c2_sample.csv"); e = pd.read_csv("c2_repro.csv")
m = a.merge(e, on="race_id", suffixes=("", "_exact"))
res["monthly_vs_exact"] = {"n": int(len(m)), "mean_abs_diff": round(float((m.C2 - m.C2_exact).abs().mean()), 5),
                           "max_abs_diff": round(float((m.C2 - m.C2_exact).abs().max()), 4)}
snap = pd.read_csv(R1 / "c2.csv"); snap = snap[snap.stage == "racecard"]
ms = e.merge(snap, on="race_id", suffixes=("", "_snap"))
res["repro_vs_snapshot"] = {"n": int(len(ms)), "n_layer_equal": round(float((ms.n_layer == ms.n_layer_snap).mean()), 4),
                            "b1win_equal": round(float((ms.b1win == ms.b1win_snap).mean()), 4),
                            "b1win_absdiff_max": int((ms.b1win - ms.b1win_snap).abs().max()),
                            "C2_mean_abs_diff": round(float((ms.C2 - (1 - ms.b1win_snap / ms.n_snap)).abs().mean()), 5)}
# 候補をそろえる
trL = R[R.date < "2025-06-01"]
D = R.merge(a.rename(columns={"race_id": "race_id_s"}), on="race_id_s", how="inner")
D["C3"], _ = fit_predict(trL, D); D["C3x"], _ = fit_predict(trL, D, exh=True)
D["C1f"] = D.C1.fillna(trL.y.mean())
mo = trL.Op.notna() & (trL.date >= "2023-01-01")
D["Op_cal"] = platt(trL.loc[mo, "Op"], trL.loc[mo, "y"], D.Op.fillna(D.Op.median()))
D = D[D.C2.notna()].copy()
rng = np.random.default_rng(5)
D["strat"] = False
for d, g in D.groupby("date"):
    D.loc[rng.choice(g.index, min(8, len(g)), replace=False), "strat"] = True
CANDS = ["C2", "C1f", "C3", "Op_cal", "C3x"]
def block(d, cands, label):
    r = {"n": int(len(d)), "days": int(d.date.nunique()), "dates": [str(d.date.min().date()), str(d.date.max().date())]}
    for c in cands:
        r[c] = metrics(d.y, d[c])
    r["boot_auc_C2-C3"] = boot_diff(d, "C2", "C3"); r["boot_brier_C2-C3"] = boot_diff(d, "C2", "C3", kind="brier")
    r["boot_auc_C2-C1"] = boot_diff(d, "C2", "C1f"); r["boot_brier_C2-C1"] = boot_diff(d, "C2", "C1f", kind="brier")
    r["boot_auc_C2-Op"] = boot_diff(d, "C2", "Op_cal"); r["boot_brier_C2-Op"] = boot_diff(d, "C2", "Op_cal", kind="brier")
    return r
A = D[D.strat]
res["A_strat_2025-06~2026-10-10"] = block(A, CANDS, "A")
res["A2_strat_2025-12-03~"] = block(A[A.date >= "2025-12-03"], CANDS, "A2")
B = D[(D.date >= "2026-09-22") & D.O_comp.notna()].copy()
cal = R[(R.date >= "2026-08-11") & (R.date <= "2026-09-21") & R.O_comp.notna()]
B["O_cal"] = platt(cal.O_comp, cal.y, B.O_comp)
rb = block(B, CANDS + ["O_cal"], "B")
rb["boot_auc_C2-O"] = boot_diff(B, "C2", "O_cal"); rb["boot_brier_C2-O"] = boot_diff(B, "C2", "O_cal", kind="brier")
res["B_all_2026-09-22~10-10_withO"] = rb
# n_layer < 400
small = A[A.n_layer < 400]; big = A[A.n_layer >= 400]
res["small_layer"] = {"share_n_layer_lt400": round(float((A.n_layer < 400).mean()), 4),
                      "n_layer_quantiles": A.n_layer.quantile([.05, .1, .25, .5]).round(0).to_dict()}
if len(small) >= 50:
    q = pd.qcut(small.C2.rank(method="first"), 5, labels=False)
    res["small_layer"]["quintile_cal"] = small.groupby(q).agg(pred=("C2", "mean"), obs=("y", "mean"), n=("y", "size")).round(3).to_dict("list")
    res["small_layer"]["brier_C2_small"] = round(float(np.mean((small.C2 - small.y) ** 2)), 5)
    res["small_layer"]["brier_C3_small"] = round(float(np.mean((small.C3 - small.y) ** 2)), 5)
    res["small_layer"]["auc_C2_small"] = round(roc_auc_score(small.y, small.C2), 4)
    res["small_layer"]["auc_C3_small"] = round(roc_auc_score(small.y, small.C3), 4)
# 縮小版: (非1着数 + m×事前) / (n + m)。事前は C1（級の並びの率）か全国の率。m は 2025-12-02 までの抽出で決め、以後で評価
D["k"] = D.n - D.b1win
fitp = D[D.strat & (D.date <= "2025-12-02")]; evp = D[D.strat & (D.date >= "2025-12-03")]
shr = {}
for prior in ("C1f", "base"):
    pr_fit = fitp.C1f if prior == "C1f" else pd.Series(trL.y.mean(), index=fitp.index)
    grid = [0, 10, 25, 50, 100, 200, 400, 800]
    br = {mm: float(np.mean(((fitp.k + mm * pr_fit) / (fitp.n + mm) - fitp.y) ** 2)) for mm in grid}
    best = min(br, key=br.get)
    pr_ev = evp.C1f if prior == "C1f" else pd.Series(trL.y.mean(), index=evp.index)
    p = (evp.k + best * pr_ev) / (evp.n + best)
    ev = evp.assign(C2s=p)
    shr[prior] = {"m_best": best, "fit_brier_by_m": {k: round(v, 5) for k, v in br.items()},
                  "eval": {k: v for k, v in metrics(ev.y, ev.C2s).items() if k in ("auc", "brier", "top10", "bot10", "cal_maxgap")},
                  "eval_C2_raw": {k: v for k, v in metrics(ev.y, ev.C2).items() if k in ("auc", "brier", "top10", "bot10", "cal_maxgap")},
                  "boot_brier_C2s-C2": boot_diff(ev, "C2s", "C2", kind="brier"), "boot_auc_C2s-C3": boot_diff(ev, "C2s", "C3")}
res["shrink"] = shr
# C2 と C3 の平均（参考）
A = A.assign(C2C3=(A.C2 + A.C3) / 2)
res["ref_C2C3_mean"] = {k: v for k, v in metrics(A.y, A.C2C3).items() if k in ("auc", "brier")} | {"boot_auc_vs_C3": boot_diff(A, "C2C3", "C3")}
res["ref_spearman"] = A[["C2", "C3", "C1f", "Op_cal"]].corr("spearman").round(3).to_dict()
res["ref_same_venue_share_median"] = round(float(A.same_venue_share.median()), 3)
json.dump(res, open("result2.json", "w"), ensure_ascii=False, indent=1, default=str)
print(json.dumps(res, ensure_ascii=False, indent=1, default=str))
