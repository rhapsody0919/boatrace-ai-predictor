"""本番 O を朝（0〜5時）に書いた日だけ（2026-09-22〜10-10）で比べ直す。夜に日ごと書き直した日は当日の結果が混ざりうる（BOA-628）"""
import json
import numpy as np, pandas as pd
exec(open("analyze.py").read().split("out = {}")[0])
trS = R[R.date <= "2026-09-21"]; te = R[(R.date >= "2026-09-22") & (R.date <= "2026-10-10")].copy()
te["C3"], _ = fit_predict(trS, te); te["C3x"], _ = fit_predict(trS, te, exh=True); te["C1f"] = te.C1.fillna(trS.y.mean())
d = te[te.O_comp.notna()].copy()
cal = R[(R.date >= "2026-08-11") & (R.date <= "2026-09-21") & R.O_comp.notna()]
d["O_cal"] = platt(cal.O_comp, cal.y, d.O_comp)
m_ = trS.Op.notna() & (trS.date >= "2023-01-01"); d["Op_cal"] = platt(trS.loc[m_, "Op"], trS.loc[m_, "y"], d.Op)
mg = trS.gap.notna() & (trS.date >= "2023-01-01"); d["gap_cal"] = platt(-trS.loc[mg, "gap"], trS.loc[mg, "y"], -d.gap.fillna(0))
r = {"n": int(len(d)), "dates": [str(d.date.min().date()), str(d.date.max().date())]}
for c in ("O_cal", "Op_cal", "gap_cal", "C1f", "C3", "C3x"):
    r[c] = {k: v for k, v in metrics(d.y, d[c]).items() if k in ("auc", "brier", "top10", "bot10", "cal_maxgap", "base")}
r["boot_auc_C3-O"] = boot_diff(d, "C3", "O_comp"); r["boot_auc_Op-O"] = boot_diff(d, "Op", "O_comp")
r["boot_auc_C1-O"] = boot_diff(d, "C1f", "O_comp"); r["boot_auc_gap-O"] = boot_diff(d.assign(g=-d.gap), "g", "O_comp")
r["boot_brier_C3-O"] = boot_diff(d, "C3", "O_cal", kind="brier"); r["boot_brier_C1-O"] = boot_diff(d, "C1f", "O_cal", kind="brier")
json.dump(r, open("clean_o.json", "w"), ensure_ascii=False, indent=1); print(json.dumps(r, ensure_ascii=False))
