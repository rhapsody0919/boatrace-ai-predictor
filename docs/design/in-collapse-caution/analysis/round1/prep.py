"""レース単位の候補量を作る（すべて前日までの値）。boats.pkl → races.pkl"""
import sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, "/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/ml/analogy")
import features as F
S = Path(__file__).parent
df = pd.read_pickle(S / "boats.pkl")
df["race_date"] = pd.to_datetime(df["race_date"])
st_ok = pd.to_numeric(df["st_result"], errors="coerce").where(~df["is_flying"].astype(bool) & ~df["is_late"].astype(bool))
df["st_ok"] = st_ok

# --- 1コースの平均ST（実進入1コースの直近30走、F・L は平均から除き窓に数える、前日まで）
h = df.loc[df["course"] == 1, ["racer_id", "race_date", "race_number", "st_ok"]].sort_values(["racer_id", "race_date", "race_number"])
g = h.groupby("racer_id", sort=False)["st_ok"]
h["c1_mean"] = g.transform(lambda s: s.rolling(30, min_periods=1).mean())
h["c1_n"] = g.transform(lambda s: s.rolling(30, min_periods=1).count())
last = h.groupby(["racer_id", "race_date"], sort=False).tail(1)[["racer_id", "race_date", "c1_mean", "c1_n"]]
# --- 全期間の平均ST（O の再現用。pool の全履歴の累積、前日まで）
a = df[["racer_id", "race_date", "race_number", "st_ok"]].sort_values(["racer_id", "race_date", "race_number"])
a["cs"] = a["st_ok"].fillna(0).groupby(a["racer_id"]).cumsum()
a["cn"] = a["st_ok"].notna().astype(int).groupby(a["racer_id"]).cumsum()
alast = a.groupby(["racer_id", "race_date"], sort=False).tail(1)[["racer_id", "race_date", "cs", "cn"]]

b1 = df[df["boat_number"] == 1].copy()
t = b1[["racer_id", "race_date"]].copy(); t["_i"] = b1.index
t = t.sort_values("race_date")
m = pd.merge_asof(t, last.sort_values("race_date"), on="race_date", by="racer_id", allow_exact_matches=False)
m = pd.merge_asof(m.sort_values("race_date"), alast.sort_values("race_date"), on="race_date", by="racer_id", allow_exact_matches=False)
m = m.set_index("_i")
b1["c1_mean"] = m["c1_mean"]; b1["c1_n"] = m["c1_n"].fillna(0)
b1["st_all"] = (m["cs"] / m["cn"].where(m["cn"] > 0))

# --- 6艇の値
w = df.pivot_table(index="race_id", columns="boat_number", values="nat_win", aggfunc="first")
cl = df.pivot_table(index="race_id", columns="boat_number", values="cls_ord", aggfunc="first")
R = b1.set_index("race_id")[["race_date", "venue_code", "race_number", "race_ok", "y_win", "is_flying", "is_late", "finish_rank",
                              "cls", "cls_ord", "nat_win", "loc_win", "st_mean30", "st_n", "c1_mean", "c1_n", "st_all",
                              "exh_time", "exh_time_rank", "exh_time_diff", "grade", "round"]].copy()
W = w.reindex(R.index).to_numpy(float)
R["sigma6"] = np.where(np.isfinite(W).sum(1) >= 4, np.nanstd(W, axis=1), np.nan)
R["top_other"] = np.nanmax(W[:, 1:], axis=1)
R["gap"] = R["nat_win"] - R["top_other"]
C = cl.reindex(R.index).to_numpy(float)
ok6 = np.isfinite(C).all(1)
for k, name in ((4, "A1"), (3, "A2"), (2, "B1"), (1, "B2")):
    R[f"n_{name}"] = np.where(ok6, (C == k).sum(1), np.nan)
    R[f"o_{name}"] = np.where(ok6, (C[:, 1:] == k).sum(1), np.nan)
R["comp"] = np.where(ok6, R["n_A1"].astype("Int64").astype(str) + R["n_A2"].astype("Int64").astype(str) + R["n_B1"].astype("Int64").astype(str) + R["n_B2"].astype("Int64").astype(str), None)
R = R.reset_index()
R["y"] = 1 - R["y_win"].astype(int)

# --- 会場の1号艇1着率（直近90日、前日まで）。母集団は完全レース
ok = R[R["race_ok"]]
dv = ok.groupby(["venue_code", "race_date"]).agg(n=("y", "size"), k=("y_win", "sum")).reset_index()
out = []
for v, gv in dv.groupby("venue_code"):
    s = gv.set_index("race_date")[["n", "k"]].asfreq("D", fill_value=0)
    r = s.rolling("90D").sum().shift(1, freq="D")
    r["venue_code"] = v; out.append(r.reset_index())
vr = pd.concat(out); vr["venue_b1win90"] = vr["k"] / vr["n"].where(vr["n"] >= 30)
R = R.merge(vr[["venue_code", "race_date", "venue_b1win90"]], on=["venue_code", "race_date"], how="left")

# --- C1: 級の構成＋1号艇の級別、会場(VC)・全国(NC)の前日までの非1着率
def before(keys):
    a = ok.groupby(keys + ["race_date"]).agg(n=("y", "size"), k=("y", "sum")).reset_index().sort_values(keys + ["race_date"])
    gg = a.groupby(keys, sort=False)
    a["cn"] = gg["n"].cumsum() - a["n"]; a["ck"] = gg["k"].cumsum() - a["k"]
    return a[keys + ["race_date", "cn", "ck"]]
vc = before(["venue_code", "comp", "cls"]).rename(columns={"cn": "vc_n", "ck": "vc_k"})
nc = before(["comp", "cls"]).rename(columns={"cn": "nc_n", "ck": "nc_k"})
R = R.merge(vc, on=["venue_code", "comp", "cls", "race_date"], how="left").merge(nc, on=["comp", "cls", "race_date"], how="left")
# 同じ日に同じキーの完全レースが無いと merge で取れないので asof で補う
for kk, nm in ((["venue_code", "comp", "cls"], "vc"), (["comp", "cls"], "nc")):
    miss = R[f"{nm}_n"].isna() & R["comp"].notna()
    if miss.any():
        src = (vc if nm == "vc" else nc).copy()
        # その日を含む累積（＝翌日以降の「前日まで」）
        src2 = ok.groupby(kk + ["race_date"]).agg(n=("y", "size"), k=("y", "sum")).reset_index().sort_values(kk + ["race_date"])
        src2[f"{nm}_n2"] = src2.groupby(kk)["n"].cumsum(); src2[f"{nm}_k2"] = src2.groupby(kk)["k"].cumsum()
        src2["_key"] = src2[kk].astype(str).agg("|".join, axis=1)
        tt = R.loc[miss, kk + ["race_date"]].copy(); tt["_key"] = tt[kk].astype(str).agg("|".join, axis=1); tt["_i"] = tt.index
        mm = pd.merge_asof(tt.sort_values("race_date"), src2[["_key", "race_date", f"{nm}_n2", f"{nm}_k2"]].sort_values("race_date"),
                           on="race_date", by="_key", allow_exact_matches=False).set_index("_i")
        R.loc[miss, f"{nm}_n"] = mm[f"{nm}_n2"].fillna(0); R.loc[miss, f"{nm}_k"] = mm[f"{nm}_k2"].fillna(0)
R.to_pickle(S / "races.pkl")
print(R.shape, R["race_ok"].sum(), R[["c1_mean", "st_mean30", "st_all", "vc_n", "nc_n", "venue_b1win90"]].notna().mean().round(3).to_dict())
