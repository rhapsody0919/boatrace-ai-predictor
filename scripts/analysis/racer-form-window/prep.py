"""選手の直近N走の率（調子）の検証: 下ごしらえ。
入力: data/ml/dataset.csv・start_timings.csv（scripts/ml/export-training-data.js の出力、本番の読み取りの写し）
出力: work/rows.pkl（選手×走の行、過去だけから作った特徴量つき）
"""
import sys, numpy as np, pandas as pd
ML = sys.argv[1]; OUT = sys.argv[2]
NS = [10, 20, 30, 50]
d = pd.read_csv(f"{ML}/dataset.csv", low_memory=False)
s = pd.read_csv(f"{ML}/start_timings.csv")
s = s.rename(columns={"racer_id": "racer_id_st"})
d = d.merge(s[["race_id", "boat_number", "racer_id_st", "start_timing", "is_flying"]], on=["race_id", "boat_number"], how="left")
d["racer_id"] = d["racer_id"].fillna(d["racer_id_st"])
mism = ((d.racer_id_st.notna()) & (d.racer_id != d.racer_id_st)).sum()
print("racer_id mismatch dataset vs st:", mism)
print("racer_id coverage by month:\n", d.racer_id.notna().groupby(d.race_date.str[:7]).mean().round(3).to_dict())
d = d.dropna(subset=["racer_id"]).copy()
d["racer_id"] = d.racer_id.astype(int)
d["win"] = (d.finish_pos == 1).astype(float)
d["top2"] = d.finish_pos.isin([1, 2]).astype(float)
d["top3"] = d.finish_pos.isin([1, 2, 3]).astype(float)
d["st"] = np.where(d.is_flying.fillna(False).astype(bool), np.nan, d.start_timing)
d = d.sort_values(["racer_id", "race_date", "race_number"]).reset_index(drop=True)
g = d.groupby("racer_id", sort=False)
d["k"] = g.cumcount()  # この走より前の走数（データ内）
for col in ["win", "top2", "top3"]:
    prev = g[col].shift(1)
    d[f"{col}_exp"] = prev.groupby(d.racer_id).transform(lambda x: x.expanding().mean())
    for n in NS:
        d[f"{col}_r{n}"] = prev.groupby(d.racer_id).transform(lambda x, n=n: x.rolling(n, min_periods=n).mean())
prev_st = g["st"].shift(1)
d["st_exp"] = prev_st.groupby(d.racer_id).transform(lambda x: x.expanding(min_periods=10).mean())
for n in NS:
    d[f"st_r{n}"] = prev_st.groupby(d.racer_id).transform(lambda x, n=n: x.rolling(n, min_periods=int(n * 0.8)).mean())
# 次の10走の平均（未来。目的変数専用）
for col in ["win", "top2", "top3", "st"]:
    d[f"{col}_next10"] = g[col].transform(lambda x: x[::-1].rolling(10, min_periods=8).mean()[::-1].shift(-1))
d.to_pickle(OUT)
print("rows", len(d), "racers", d.racer_id.nunique(), d.race_date.min(), d.race_date.max())
