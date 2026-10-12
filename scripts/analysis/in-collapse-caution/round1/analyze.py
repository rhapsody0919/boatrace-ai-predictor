"""BOA-822 第1回: 1号艇の非1着（イン崩れ）を当てる量の比較。時系列分割・前日までの値のみ"""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss
S = Path(__file__).parent
R = pd.read_pickle(S / "races.pkl")
R = R[R.race_ok].copy()
R["date"] = R.race_date
R["race_id_s"] = R.race_id.astype(str).str.replace(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$", r"\1-\2-\3-\4-\5", regex=True)
VW = {14: (.52, .30), 24: (.50, .32), 20: (.48, .32), 15: (.46, .34), 3: (.46, .34), 17: (.44, .36), 16: (.44, .36), 9: (.44, .36)}

def composite(st_col):
    """O の式から AI 逃げ因子を抜いたもの（JS と同じ正規化・欠けた因子は重みごと外す）"""
    v = R.venue_code.astype(int)
    wst = v.map(lambda x: VW.get(x, (.38, .42))[0]); wwr = v.map(lambda x: VW.get(x, (.38, .42))[1])
    fw = 1 - np.clip(R.nat_win / 8.5, 0, 1); fs = np.clip((R[st_col] - .07) / (.34 - .07), 0, 1)
    fg = np.clip((R.sigma6 - .06) / (2.75 - .06), 0, 1); fv = 1 - np.clip((R.venue_b1win90 - .43) / (.62 - .43), 0, 1)
    num = np.zeros(len(R)); den = np.zeros(len(R))
    for f, wt in ((fw, wwr), (fs, wst), (fg, .05), (fv, .03)):
        okf = f.notna().to_numpy(); num += np.where(okf, f.fillna(0) * wt, 0); den += np.where(okf, wt, 0)
    return pd.Series(num / np.where(den > 0, den, np.nan), index=R.index)
R["Op"] = composite("st_mean30")
R["Op_allst"] = composite("st_all")
base_all = None
def c1(r):
    pass
glob = R.y.expanding().mean()  # 使わない
R["C1"] = np.where(R.vc_n >= 300, R.vc_k / R.vc_n, np.where(R.nc_n > 0, R.nc_k / R.nc_n.where(R.nc_n > 0), np.nan))
R["C1_src"] = np.where(R.vc_n >= 300, "VC", np.where(R.nc_n > 0, "NC", "none"))

# 保存済みの O
O = pd.read_csv(S / "o_saved.csv")
O["pj"] = pd.to_datetime(O.predicted_at, utc=True, format="ISO8601").dt.tz_convert("Asia/Tokyo")
O["lag"] = (O.pj.dt.tz_localize(None).dt.normalize() - pd.to_datetime(O.race_id.str[:10])).dt.days
O = O[O.lag == 0].rename(columns={"race_id": "race_id_s", "comp": "O_comp", "pct": "O_pct", "fb": "O_fb", "nige": "O_nige"})
R = R.merge(O[["race_id_s", "O_comp", "O_pct", "O_fb", "O_nige"]], on="race_id_s", how="left")
R.loc[R.O_fb.astype(str) == "True", "O_pct"] = np.nan
C2 = pd.read_csv(S / "c2.csv")
for st in ("racecard", "exhibition"):
    c = C2[C2.stage == st]
    R = R.merge(c.assign(**{f"C2_{st}": 1 - c.b1win / c.n})[["race_id", f"C2_{st}"]].rename(columns={"race_id": "race_id_s"}), on="race_id_s", how="left")

# ---- C3
def design(d, cols_num, venue=True, exh=False):
    X = pd.DataFrame(index=d.index)
    for c in cols_num:
        X[c] = d[c]
    X["loc_win"] = d.loc_win.where(d.loc_win > 0)
    X["c1st"] = d.c1_mean.where(d.c1_n >= 5, d.st_mean30)
    for k in ("A1", "A2", "B1", "B2"):
        X[f"b1_{k}"] = (d.cls.astype(str) == k).astype(float)
    for k in ("A1", "A2", "B1"):
        X[f"o_{k}"] = d[f"o_{k}"]
    if venue:
        for v in range(1, 25):
            X[f"v{v}"] = (d.venue_code.astype(int) == v).astype(float)
    if exh:
        for k in range(1, 7):
            X[f"exr{k}"] = (d.exh_time_rank == k).astype(float)
        X["exd"] = d.exh_time_diff
    return X
NUM = ["st_mean30", "nat_win", "gap"]
def fit_predict(train, test, exh=False):
    Xtr = design(train, NUM, exh=exh); Xte = design(test, NUM, exh=exh)
    med = Xtr.median(); miss_cols = [c for c in Xtr if Xtr[c].isna().any() or Xte[c].isna().any()]
    for c in miss_cols:
        Xtr[c + "_na"] = Xtr[c].isna().astype(float); Xte[c + "_na"] = Xte[c].isna().astype(float)
    Xtr = Xtr.fillna(med); Xte = Xte.fillna(med)
    mu, sd = Xtr.mean(), Xtr.std().replace(0, 1)
    m = LogisticRegression(C=1.0, max_iter=2000).fit((Xtr - mu) / sd, train.y)
    coef = pd.Series(m.coef_[0], index=Xtr.columns)
    return m.predict_proba((Xte - mu) / sd)[:, 1], coef

def platt(train_s, train_y, test_s):
    m = LogisticRegression(C=1e6, max_iter=1000).fit(np.asarray(train_s).reshape(-1, 1), train_y)
    return m.predict_proba(np.asarray(test_s).reshape(-1, 1))[:, 1]

def metrics(y, p, prob=True):
    y = np.asarray(y); p = np.asarray(p, float)
    q = pd.qcut(pd.Series(p).rank(method="first"), 10, labels=False)
    dec = pd.DataFrame({"y": y, "p": p, "q": q}).groupby("q").agg(pm=("p", "mean"), ym=("y", "mean"), n=("y", "size"))
    out = {"n": int(len(y)), "base": round(float(y.mean()), 4), "auc": round(roc_auc_score(y, p), 4),
           "top10": round(float(dec.ym.iloc[-1]), 4), "bot10": round(float(dec.ym.iloc[0]), 4)}
    if prob:
        out |= {"brier": round(brier_score_loss(y, p), 5), "logloss": round(log_loss(y, np.clip(p, 1e-4, 1 - 1e-4)), 5),
                "dec_pred": dec.pm.round(3).tolist(), "dec_obs": dec.ym.round(3).tolist(),
                "cal_maxgap": round(float((dec.pm - dec.ym).abs().max()), 3)}
    else:
        out["dec_obs"] = dec.ym.round(3).tolist()
    return out

def fast_auc(y, p):
    r = pd.Series(p).rank().to_numpy(); n1 = y.sum(); n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)

def boot_diff(d, a, b, reps=1000, kind="auc"):
    """日ごとのブロック・ブートストラップ（同じ日のレースをまとめて引く）。a−b"""
    days = d.date.dt.normalize().to_numpy(); ud = np.unique(days); idx = {u: np.where(days == u)[0] for u in ud}
    y = d.y.to_numpy(); pa = d[a].to_numpy(float); pb = d[b].to_numpy(float)
    rng = np.random.default_rng(1); res = []
    for _ in range(reps):
        sel = np.concatenate([idx[u] for u in rng.choice(ud, len(ud))])
        if kind == "auc":
            res.append(fast_auc(y[sel], pa[sel]) - fast_auc(y[sel], pb[sel]))
        else:
            res.append(np.mean((pa[sel] - y[sel]) ** 2) - np.mean((pb[sel] - y[sel]) ** 2))
    pt = fast_auc(y, pa) - fast_auc(y, pb) if kind == "auc" else np.mean((pa - y) ** 2) - np.mean((pb - y) ** 2)
    return [round(float(pt), 5), round(float(np.percentile(res, 2.5)), 5), round(float(np.percentile(res, 97.5)), 5)]

out = {}
# ===== 長期: 学習 2019-04〜2025-05-31、検証 2025-06-01〜2026-10-10
trL = R[R.date < "2025-06-01"]; teL = R[(R.date >= "2025-06-01") & (R.date <= "2026-10-10")].copy()
teL["C3"], coefL = fit_predict(trL, teL)
teL["C3x"], _ = fit_predict(trL, teL, exh=True)
for c in ("Op", "Op_allst", "nat_win_inv"):
    pass
teL["nat_inv"] = -teL.nat_win; trL = trL.assign(nat_inv=-trL.nat_win)
for c in ("Op", "Op_allst", "nat_inv"):
    m_ = trL[c].notna(); tm = teL[c].notna()
    teL[c + "_cal"] = np.nan
    teL.loc[tm, c + "_cal"] = platt(trL.loc[m_, c], trL.loc[m_, "y"], teL.loc[tm, c])
teL["C1f"] = teL.C1.fillna(trL.y.mean())
L = {}
L["C1"] = metrics(teL.y, teL.C1f)
L["C3"] = metrics(teL.y, teL.C3)
L["C3x(展示後)"] = metrics(teL.y, teL.C3x)
for c in ("Op", "Op_allst", "nat_inv"):
    d = teL[teL[c].notna()]
    L[c + "(Platt)"] = metrics(d.y, d[c + "_cal"])
L["_C1_src"] = teL.C1_src.value_counts().to_dict()
dd = teL.dropna(subset=["Op_cal"])
L["_boot_auc_C3_minus_Op"] = boot_diff(dd, "C3", "Op_cal")
L["_boot_auc_C1_minus_Op"] = boot_diff(dd.assign(C1f=dd.C1f), "C1f", "Op_cal")
L["_boot_auc_C3_minus_C1"] = boot_diff(teL, "C3", "C1f")
L["_boot_auc_C3x_minus_C3"] = boot_diff(teL, "C3x", "C3")
L["_boot_auc_Op_minus_Opallst"] = boot_diff(teL.dropna(subset=["Op_cal", "Op_allst_cal"]), "Op_cal", "Op_allst_cal")
L["_boot_brier_C3_minus_C1"] = boot_diff(teL, "C3", "C1f", kind="brier")
L["_boot_brier_C3_minus_Op"] = boot_diff(dd, "C3", "Op_cal", kind="brier")
L["_coef_C3"] = coefL.drop([c for c in coefL.index if c.startswith("v")]).round(3).to_dict()
out["long"] = L

# ===== 短期: 本番 O がある期間 2026-08-11〜10-10。学習は 2026-08-10 まで
trS = R[R.date <= "2026-08-10"]; teS = R[(R.date >= "2026-08-11") & (R.date <= "2026-10-10")].copy()
teS["C3"], _ = fit_predict(trS, teS); teS["C3x"], _ = fit_predict(trS, teS, exh=True)
teS["C1f"] = teS.C1.fillna(trS.y.mean())
for c in ("Op", "Op_allst"):
    m_ = trS[c].notna() & (trS.date >= "2023-01-01"); tm = teS[c].notna()
    teS[c + "_cal"] = np.nan; teS.loc[tm, c + "_cal"] = platt(trS.loc[m_, c], trS.loc[m_, "y"], teS.loc[tm, c])
S_ = {}
d = teS[teS.O_comp.notna()].copy()
S_["_n_all"] = int(len(teS)); S_["_n_withO"] = int(len(d))
# O は前半（08-11〜09-10）で Platt、後半（09-11〜10-10）で Brier
h1 = d[d.date <= "2026-09-10"]; h2 = d[d.date >= "2026-09-11"].copy()
h2["O_cal"] = platt(h1.O_comp, h1.y, h2.O_comp)
pp = h2.O_pct.notna(); h1p = h1[h1.O_pct.notna()]
h2["O_pct_cal"] = np.nan; h2.loc[pp, "O_pct_cal"] = platt(h1p.O_pct, h1p.y, h2.loc[pp, "O_pct"])
S_["AUC_fullperiod"] = {c: metrics(d.y, d[c], prob=False) for c in ("O_comp", "Op", "Op_allst", "C1f", "C3", "C3x")}
S_["AUC_fullperiod"]["O_pct"] = metrics(d[d.O_pct.notna()].y, d[d.O_pct.notna()].O_pct, prob=False)
S_["AUC_fullperiod"]["O_nige_inv"] = metrics(d.y, -d.O_nige, prob=False)
S_["H2"] = {"O(Platt前半)": metrics(h2.y, h2.O_cal), "O_pct(Platt前半)": metrics(h2[pp].y, h2[pp].O_pct_cal),
            "Op(Platt学習期間)": metrics(h2.y, h2.Op_cal), "C1": metrics(h2.y, h2.C1f), "C3": metrics(h2.y, h2.C3), "C3x": metrics(h2.y, h2.C3x)}
S_["_boot_auc_C3_minus_O"] = boot_diff(d, "C3", "O_comp")
S_["_boot_auc_C1_minus_O"] = boot_diff(d, "C1f", "O_comp")
S_["_boot_auc_Op_minus_O"] = boot_diff(d.dropna(subset=["Op"]), "Op", "O_comp")
S_["_boot_auc_C3x_minus_C3"] = boot_diff(d, "C3x", "C3")
S_["_boot_auc_C3_minus_C1"] = boot_diff(d, "C3", "C1f")
S_["_boot_brier_H2_C3_minus_O"] = boot_diff(h2, "C3", "O_cal", kind="brier")
S_["_boot_brier_H2_C1_minus_O"] = boot_diff(h2, "C1f", "O_cal", kind="brier")
S_["_corr_O_Op_spearman"] = round(float(d[["O_comp", "Op"]].corr("spearman").iloc[0, 1]), 3)
out["short"] = S_

# ===== C2 がある期間（2026-10-06〜10-10）
c2 = teS[teS.C2_racecard.notna()].copy()
X = {"_n": int(len(c2))}
for c in ("C2_racecard", "C1f", "C3", "O_comp", "Op"):
    dd2 = c2[c2[c].notna()]
    X[c] = metrics(dd2.y, dd2[c], prob=c in ("C2_racecard", "C1f", "C3"))
ce = c2[c2.C2_exhibition.notna()]
X["_n_exh"] = int(len(ce))
X["C2_exhibition"] = metrics(ce.y, ce.C2_exhibition); X["C3x_on_exh"] = metrics(ce.y, ce.C3x); X["C2_racecard_on_exh"] = metrics(ce.y, ce.C2_racecard)
X["_boot_auc_C2_minus_C3"] = boot_diff(c2, "C2_racecard", "C3")
X["_boot_auc_C2_minus_C1"] = boot_diff(c2, "C2_racecard", "C1f")
X["_boot_auc_C2_minus_O"] = boot_diff(c2.dropna(subset=["O_comp"]), "C2_racecard", "O_comp")
X["_boot_brier_C2_minus_C3"] = boot_diff(c2, "C2_racecard", "C3", kind="brier")
X["_corr_spearman"] = c2[["C2_racecard", "C1f", "C3", "O_comp"]].corr("spearman").round(3).to_dict()
out["c2"] = X
json.dump(out, open(S / "result.json", "w"), ensure_ascii=False, indent=1, default=str)
print(json.dumps(out, ensure_ascii=False, default=str)[:200])
