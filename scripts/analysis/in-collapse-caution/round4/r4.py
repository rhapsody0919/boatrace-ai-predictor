"""BOA-822 第4回: B05（勝率差0.5刻みの帯の全国の前日までの非1着率）の検証。読み取りのみ。
入力: ds-round1/races.pkl・analyze.py（O・O'・関数）、ds-round3/c2_round3.csv（A の抽出の再現）、
      欠場レース用に kb_boats.csv・kb_races.csv（export_pool.js の出力、ANALOGY_DATA_DIR）と ds-round1/pool の本体 CSV"""
import json, os
from pathlib import Path
import numpy as np, pandas as pd
from scipy.stats import spearmanr
HERE = Path(__file__).parent; R1 = HERE.parent / "round1"; R3 = HERE.parent / "round3"
KB = Path(os.environ.get("ANALOGY_DATA_DIR", "data/ml/analogy"))  # export_pool.js の kb_boats.csv・kb_races.csv
os.chdir(R1)
exec(open("analyze.py").read().split("out = {}")[0].replace("S = Path(__file__).parent", "S = R1"))
os.chdir(HERE)
res = {}
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]

# ---- 勝率差（1/100 の整数）と帯
R["nat_i"] = np.round(R.nat_win.astype("float64") * 100)
R["top_i"] = np.round(R.top_other.astype("float64") * 100)
R["gap_i"] = R.nat_i - R.top_i
def band_from_int(g): return np.where(np.isfinite(g), np.clip(np.floor(g / 50), -8, 6), -99)
R["gb"] = band_from_int(R.gap_i)
R["gb_float32"] = np.where(R.gap.notna(), np.clip(np.floor(R.gap / 0.5), -8, 6), -99)   # 第3回の作り方（float32）
g64 = R.nat_win.astype("float64") - R.top_other.astype("float64")
R["gb_float64"] = np.where(g64.notna(), np.clip(np.floor(g64 / 0.5), -8, 6), -99)
res["item6"] = {"n": int(len(R)), "diff_int_vs_float32": round(float((R.gb != R.gb_float32).mean()), 5),
                "diff_int_vs_float64": round(float((R.gb != R.gb_float64).mean()), 5),
                "n_diff_int_vs_float32": int((R.gb != R.gb_float32).sum()), "n_diff_int_vs_float64": int((R.gb != R.gb_float64).sum()),
                "gap_on_boundary_share(gap_i%50==0)": round(float((R.gap_i % 50 == 0).mean()), 4)}

# ---- 帯の率（前日まで、期間つき）
def band_rate(col, years=None, extra=None):
    keys = [col] + ([extra] if extra else [])
    a = R.groupby(keys + ["date"]).agg(n=("y", "size"), k=("y", "sum")).reset_index()
    out = []
    for key, g in a.groupby(keys):
        s = g.set_index("date")[["n", "k"]].asfreq("D", fill_value=0)
        s = (s.cumsum() if years is None else s.rolling(f"{int(365.25 * years)}D").sum()).shift(1, freq="D")
        s = s.reset_index()
        for i, kk in enumerate(keys):
            s[kk] = key[i] if isinstance(key, tuple) else key
        out.append(s)
    t = pd.concat(out)
    m = R[keys + ["date"]].reset_index().merge(t, on=keys + ["date"], how="left").set_index("index").reindex(R.index)
    # 帯のレースが無い日（その日は数えない）は merge で欠ける → 直前の累積を使う
    if m["n"].isna().any():
        t2 = t.sort_values("date"); mm = R.loc[m["n"].isna(), keys + ["date"]].reset_index()
        mm["_k"] = mm[keys].astype(str).agg("|".join, axis=1); t2["_k"] = t2[keys].astype(str).agg("|".join, axis=1)
        f = pd.merge_asof(mm.sort_values("date"), t2[["_k", "date", "n", "k"]].sort_values("date"), on="date", by="_k").set_index("index")
        m.loc[f.index, ["n", "k"]] = f[["n", "k"]].to_numpy()
    return m["k"] / m["n"].where(m["n"] > 0), m["n"]
R["B05"], R["B05_n"] = band_rate("gb")
for yrs in (3, 2, 1):
    R[f"B05_{yrs}y"], R[f"B05_{yrs}y_n"] = band_rate("gb", years=yrs)
R["rgrp"] = np.select([R["round"] == "junyu", R["round"] == "yusho"], ["junyu", "yusho"], "other")
R["B05r"], R["B05r_n"] = band_rate("gb", extra="rgrp")
trL = R[R.date < "2025-06-01"]; base0 = trL.y.mean()
for c in ("B05", "B05_3y", "B05_2y", "B05_1y", "B05r"):
    R[c + "f"] = R[c].fillna(base0)
mo = trL.Op.notna() & (trL.date >= "2023-01-01")
R["Op_cal"] = platt(trL.loc[mo, "Op"], trL.loc[mo, "y"], R.Op.fillna(R.Op.median()))
L = R[(R.date >= "2025-06-01") & (R.date <= "2026-10-10")].copy()   # 長期の全件
B = L[(L.date >= "2026-09-22") & L.O_comp.notna()].copy()
cal = R[(R.date >= "2026-08-11") & (R.date <= "2026-09-21") & R.O_comp.notna()]
B["O_cal"] = platt(cal.O_comp, cal.y, B.O_comp)
c3 = pd.read_csv(R3 / "c2_round3.csv")
Aids = c3[c3.in_sample].race_id
Ds = L[L.race_id_s.isin(set(Aids))]
rng = np.random.default_rng(5); strat = []
for d, g in Ds.groupby("date"):
    strat += list(rng.choice(g.index, min(8, len(g)), replace=False))
A = L.loc[strat].copy()
res["sets"] = {"L_all_2025-06~2026-10-10": int(len(L)), "A_strat": int(len(A)), "B": int(len(B))}
pick = lambda m: {k: m[k] for k in ("n", "auc", "brier", "top10", "bot10", "cal_maxgap")}

# ---- 1. B05 と O・O'
res["item1_B"] = {"B05": pick(metrics(B.y, B.B05f)), "O": pick(metrics(B.y, B.O_cal)), "Op": pick(metrics(B.y, B.Op_cal)),
                  "boot_auc_B05-O": boot_diff(B, "B05f", "O_comp"), "boot_brier_B05-O": boot_diff(B, "B05f", "O_cal", kind="brier"),
                  "boot_auc_B05-Op": boot_diff(B, "B05f", "Op_cal"), "boot_brier_B05-Op": boot_diff(B, "B05f", "Op_cal", kind="brier")}
res["item1_L"] = {"B05": pick(metrics(L.y, L.B05f)), "Op": pick(metrics(L.y, L.Op_cal)),
                  "boot_auc_B05-Op": boot_diff(L, "B05f", "Op_cal"), "boot_brier_B05-Op": boot_diff(L, "B05f", "Op_cal", kind="brier")}

# ---- 2. 3段
def bands(d, col, edges):
    b = np.digitize(d[col], edges); rows = []
    for j in range(len(edges) + 1):
        x = d[b == j]
        rows.append({"band": j, "n": int(len(x)), "share": round(len(x) / len(d), 3), "pred": round(float(x[col].mean()), 3),
                     "obs": round(float(x.y.mean()), 3), "wilson95": wilson(x.y.sum(), len(x))})
    return rows
q = L.B05f.quantile([1/3, 2/3]).round(3).tolist()
schemes = {"35/55": [0.35, 0.55], "37/53(全国±8pt)": [0.37, 0.53], f"3等分の分位({q[0]}/{q[1]})": q}
res["item2"] = {nm: {sn: bands(d, "B05f", e) for sn, e in schemes.items()} for nm, d in (("A", A), ("B", B), ("L_all", L))}
res["item2_B05_distinct_values_L"] = int(L.B05f.round(4).nunique())
res["item2_band_table_latest"] = (R[R.date == "2026-10-10"].groupby("gb").agg(rate=("B05f", "first"), n=("B05_n", "first"))
                                  .round(4).reset_index().to_dict("records"))

# ---- 3. 期間
it3 = {}
for c in ("B05", "B05_3y", "B05_2y", "B05_1y"):
    r = {}
    for nm, d in (("L_all", L), ("B", B)):
        r[nm] = pick(metrics(d.y, d[c + "f"]))
    r["min_band_n_in_L"] = int(L[c + "_n"].min()); r["p1_band_n_in_L"] = int(L[c + "_n"].quantile(0.01))
    r["share_band_n_lt100_L"] = round(float((L[c + "_n"] < 100).mean()), 4)
    if c != "B05":
        r["boot_brier_vs_all_L"] = boot_diff(L, c + "f", "B05f", kind="brier")
        r["boot_auc_vs_all_L"] = boot_diff(L, c + "f", "B05f")
    it3[c] = r
res["item3"] = it3

# ---- 4. ラウンド別
it4 = {}
for rg in ("other", "junyu", "yusho"):
    d = L[L.rgrp == rg]
    r = {"n": int(len(d)), "base": round(float(d.y.mean()), 3), "B05": pick(metrics(d.y, d.B05f)), "B05r": pick(metrics(d.y, d.B05rf)),
         "boot_brier_B05r-B05": boot_diff(d, "B05rf", "B05f", kind="brier"), "boot_auc_B05r-B05": boot_diff(d, "B05rf", "B05f"),
         "mean_pred_B05": round(float(d.B05f.mean()), 3),
         "B05r_cell_n_min": int(d.B05r_n.min()), "B05r_cell_n_p10": int(d.B05r_n.quantile(.1)),
         "share_cell_n_lt100": round(float((d.B05r_n < 100).mean()), 3), "share_cell_n_lt300": round(float((d.B05r_n < 300).mean()), 3)}
    it4[rg] = r
it4["all_B05r"] = pick(metrics(L.y, L.B05rf)); it4["boot_brier_all_B05r-B05"] = boot_diff(L, "B05rf", "B05f", kind="brier")
res["item4"] = it4

# ---- 5. 欠場で5艇になったレース
kb = pd.read_csv(KB / "kb_boats.csv", usecols=["race_id", "boat_number", "national_win_rate", "finish_raw", "finish_rank"], dtype={"finish_raw": str})
kr = pd.read_csv(KB / "kb_races.csv", usecols=["race_id", "race_date", "has_result"])
kb = kb.merge(kr, on="race_id")
kb = kb[kb.has_result.astype(str).str.lower() == "true"]
kb["absent"] = kb.finish_raw.fillna("").str.startswith("K")
kb["code"] = kb.finish_raw.where(kb.absent)
P = R1 / "pool"
ent = pd.read_csv(P / "entries.csv", usecols=["race_id", "boat_number", "win_rate", "is_absent"])
exh = pd.read_csv(P / "exhibition.csv", usecols=["race_id", "boat_number", "is_absent"]).rename(columns={"is_absent": "x_abs"})
res_ = pd.read_csv(P / "results.csv", usecols=["race_id", "rank1", "is_cancelled", "is_no_race", "race_status"])
races_ = pd.read_csv(P / "races.csv", usecols=["race_id", "race_date", "cancellation_status"])
mn = ent.merge(exh, on=["race_id", "boat_number"], how="left").merge(res_, on="race_id").merge(races_, on="race_id")
mn = mn[(mn.race_date > "2025-12-02") & mn.rank1.notna() & (mn.is_cancelled.astype(str).str.lower() != "true")
        & (mn.is_no_race.astype(str).str.lower() != "true") & (mn.race_status != "no_race") & mn.cancellation_status.isna()]
mn["absent"] = (mn.is_absent.astype(str).str.lower() == "true") | (mn.x_abs.astype(str).str.lower() == "true")
mn["win1"] = mn.rank1 == 1
kb["win1"] = kb.finish_rank == 1
kbx = kb.groupby("race_id").agg(date=("race_date", "first"), n_abs=("absent", "sum"), codes=("code", lambda s: ",".join(sorted(s.dropna()))))
mnx = mn.groupby("race_id").agg(date=("race_date", "first"), n_abs=("absent", "sum"))
mnx["codes"] = "main"
def gap_rows(df, rate_col):
    d = df.copy(); d["nat_i"] = np.round(d[rate_col].astype(float) * 100)
    b1 = d[d.boat_number == 1].set_index("race_id")
    oth = d[(d.boat_number != 1) & ~d.absent].groupby("race_id").nat_i.max()
    out = pd.DataFrame({"b1_abs": b1.absent, "gap_i": b1.nat_i - oth.reindex(b1.index), "y": (~b1.win1.astype(bool)).astype(int)})
    return out
ga = pd.concat([gap_rows(kb, "national_win_rate").join(kbx), gap_rows(mn, "win_rate").join(mnx)])
ga = ga[ga.n_abs >= 1].copy(); ga["date"] = pd.to_datetime(ga.date)
res["item5_counts"] = {"races_with_absent_all": int(len(ga)), "b1_absent": int(ga.b1_abs.sum()),
                       "n_abs_dist": ga.n_abs.value_counts().to_dict(),
                       "kb_codes": ga[ga.codes != "main"].codes.value_counts().head(5).to_dict(),
                       "period_2025-06~": int((ga.date >= "2025-06-01").sum()),
                       "share_of_races_period": round(float((ga.date >= "2025-06-01").sum() / ((ga.date >= "2025-06-01").sum() + len(L))), 4)}
g = ga[~ga.b1_abs & (ga.n_abs == 1)].copy()
g["gb"] = band_from_int(g.gap_i)
# 帯の率（race_ok の全国、前日まで）を当てる
tab = R.groupby(["gb", "date"]).agg(n=("y", "size"), k=("y", "sum")).reset_index().sort_values("date")
tab["cn"] = tab.groupby("gb").n.cumsum(); tab["ck"] = tab.groupby("gb").k.cumsum()
gg = g.reset_index().sort_values("date")
f = pd.merge_asof(gg, tab[["gb", "date", "cn", "ck"]].sort_values("date"), on="date", by="gb", allow_exact_matches=False)
f["B05"] = (f.ck / f.cn).fillna(base0)
f = f[f.date >= "2019-04-01"]
it5 = {"n_eval_all": int(len(f)), "n_eval_2025-06~": int((f.date >= "2025-06-01").sum())}
for nm, d in (("all_2019~", f), ("2025-06~", f[f.date >= "2025-06-01"])):
    if len(d) >= 200 and d.y.nunique() == 2:
        m = metrics(d.y, d.B05); it5[nm] = pick(m) | {"mean_pred": round(float(d.B05.mean()), 3), "base": round(float(d.y.mean()), 3)}
same = L.sample(n=min(len(L), 20000), random_state=0)
it5["ref_race_ok_2025-06~"] = pick(metrics(same.y, same.B05f)) | {"mean_pred": round(float(same.B05f.mean()), 3)}
res["item5"] = it5
json.dump(res, open("result4.json", "w"), ensure_ascii=False, indent=1, default=str)
print("ok")
