"""補足: 単独の量の AUC、C3 の変種、C2 のレース単位ブートストラップ"""
import json
import numpy as np, pandas as pd
exec(open("analyze.py").read().split("out = {}")[0])  # 前処理と関数だけ使う
from sklearn.metrics import roc_auc_score
trL = R[R.date < "2025-06-01"]; teL = R[(R.date >= "2025-06-01") & (R.date <= "2026-10-10")].copy()
res = {}
uni = {}
for c, sign in (("gap", -1), ("nat_win", -1), ("st_mean30", 1), ("st_all", 1), ("c1_mean", 1), ("loc_win", -1),
                ("sigma6", 1), ("venue_b1win90", -1), ("C1", 1), ("o_A1", 1), ("cls_ord", -1)):
    d = teL[teL[c].notna()]
    uni[c] = [int(len(d)), round(roc_auc_score(d.y, sign * d[c]), 4)]
res["univariate_auc_long"] = uni
# 変種
NUM0 = list(NUM)
def run(num, venue=True, label=""):
    global NUM
    NUM = num
    Xtr = design(trL, NUM, venue=venue); Xte = design(teL, NUM, venue=venue)
    med = Xtr.median()
    for c in [c for c in Xtr if Xtr[c].isna().any() or Xte[c].isna().any()]:
        Xtr[c + "_na"] = Xtr[c].isna().astype(float); Xte[c + "_na"] = Xte[c].isna().astype(float)
    Xtr = Xtr.fillna(med); Xte = Xte.fillna(med); mu, sd = Xtr.mean(), Xtr.std().replace(0, 1)
    m = LogisticRegression(C=1.0, max_iter=2000).fit((Xtr - mu) / sd, trL.y)
    p = m.predict_proba((Xte - mu) / sd)[:, 1]
    NUM = NUM0
    return metrics(teL.y, p)
res["C3_noVenue"] = {k: v for k, v in run(NUM0, venue=False).items() if k in ("auc", "brier")}
res["C3_stall_instead"] = {k: v for k, v in run(["st_all", "nat_win", "gap"]).items() if k in ("auc", "brier")}
res["C3_plus_stall"] = {k: v for k, v in run(["st_mean30", "st_all", "nat_win", "gap"]).items() if k in ("auc", "brier")}
res["C3_no_st"] = {k: v for k, v in run(["nat_win", "gap"]).items() if k in ("auc", "brier")}
# ST を全部抜く: c1st も design 内で作られるので、別に作る
def run_nost():
    Xtr = design(trL, ["nat_win", "gap"]).drop(columns=["c1st"]); Xte = design(teL, ["nat_win", "gap"]).drop(columns=["c1st"])
    med = Xtr.median()
    for c in [c for c in Xtr if Xtr[c].isna().any() or Xte[c].isna().any()]:
        Xtr[c + "_na"] = Xtr[c].isna().astype(float); Xte[c + "_na"] = Xte[c].isna().astype(float)
    Xtr = Xtr.fillna(med); Xte = Xte.fillna(med); mu, sd = Xtr.mean(), Xtr.std().replace(0, 1)
    m = LogisticRegression(C=1.0, max_iter=2000).fit((Xtr - mu) / sd, trL.y)
    return metrics(teL.y, m.predict_proba((Xte - mu) / sd)[:, 1])
res["C3_no_any_st"] = {k: v for k, v in run_nost().items() if k in ("auc", "brier")}
# gap と1号艇級別だけ（2変数のロジスティック）
d = teL.dropna(subset=["gap"]); t = trL.dropna(subset=["gap"])
f = lambda x: np.c_[x.gap, x.nat_win, (x.cls.astype(str) == "A1"), (x.cls.astype(str) == "B1")].astype(float)
m = LogisticRegression(max_iter=1000).fit(f(t), t.y)
res["gap_natwin_cls_only"] = {k: v for k, v in metrics(d.y, m.predict_proba(f(d))[:, 1]).items() if k in ("n", "auc", "brier")}

# C2: レース単位のブートストラップ（5日しかないので日ブロックは使えない）
teS = R[(R.date >= "2026-08-11") & (R.date <= "2026-10-10")].copy(); trS = R[R.date <= "2026-08-10"]
teS["C3"], _ = fit_predict(trS, teS); teS["C1f"] = teS.C1.fillna(trS.y.mean())
c2 = teS[teS.C2_racecard.notna()]
def rboot(d, a, b, kind="auc", reps=2000):
    y = d.y.to_numpy(); pa = d[a].to_numpy(float); pb = d[b].to_numpy(float); rng = np.random.default_rng(2); r = []
    for _ in range(reps):
        s = rng.integers(0, len(y), len(y))
        r.append(fast_auc(y[s], pa[s]) - fast_auc(y[s], pb[s]) if kind == "auc" else np.mean((pa[s]-y[s])**2) - np.mean((pb[s]-y[s])**2))
    pt = fast_auc(y, pa) - fast_auc(y, pb) if kind == "auc" else np.mean((pa-y)**2) - np.mean((pb-y)**2)
    return [round(float(pt), 4), round(float(np.percentile(r, 2.5)), 4), round(float(np.percentile(r, 97.5)), 4)]
res["c2_raceboot"] = {"C2-C3_auc": rboot(c2, "C2_racecard", "C3"), "C2-C1_auc": rboot(c2, "C2_racecard", "C1f"),
                      "C2-O_auc": rboot(c2.dropna(subset=["O_comp"]), "C2_racecard", "O_comp"),
                      "C2-C3_brier": rboot(c2, "C2_racecard", "C3", "brier"), "C2-C1_brier": rboot(c2, "C2_racecard", "C1f", "brier"),
                      "dates": [str(c2.date.min().date()), str(c2.date.max().date())], "n": int(len(c2))}
# 上位/下位10% の件数のぶれ（長期 C3）
json.dump(res, open("extra.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
