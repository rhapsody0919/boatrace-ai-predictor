#!/usr/bin/env python3
"""BOA-1280: runs.tsv から、各走の「その日より前」だけで作った選手×進入コースの率を付ける（後出しなし）。

  python3 -I scripts/analysis/nigashi-makurare/build-features.py [work_dir]

入力 <work>/runs.tsv（fetch-runs.mjs）、出力 <work>/races.pkl（1行1レース。1号艇と2号艇の特徴と結果）。
窓: all（2019-04 からの前日まで全部）、365d、90d（いずれも当日を含まない）。
- 逃がし: 2コースに進入した走のうち、決まり手が「逃げ」だった数（098 の nigashi_count と同じ定義）
- 被まくられ: 1コースに進入した走のうち、決まり手が「まくり」（1着は他艇）。被差し=「差し」、被まくり差し=「まくり差し」
- 会場の期待値: 学習期間（〜2023-12-31）の会場×進入コースの率を、本人の過去の走の会場で平均したもの（098 の nigashi_expected の簡略版。グレードで分けない）
"""
import sys, os
import numpy as np, pandas as pd

W = sys.argv[1] if len(sys.argv) > 1 else "data/analysis/nigashi-makurare/work"
TRAIN_END = "2023-12-31"
df = pd.read_csv(os.path.join(W, "runs.tsv"), sep="\t", dtype={"race_id": str, "cls": str, "tech": str})
df["d"] = pd.to_datetime(df["d"])
df = df[df.course.between(1, 6)]
df["self_win"] = (df.winner_bn == df.bn).astype(np.int8)
df["self_top2"] = ((df.winner_bn == df.bn) | (df.second_bn == df.bn)).astype(np.int8)
df["nige"] = (df.tech == "逃げ").astype(np.int8)
df["makuri"] = ((df.tech == "まくり") & (df.self_win == 0)).astype(np.int8)
df["sashi"] = ((df.tech == "差し") & (df.self_win == 0)).astype(np.int8)
df["mz"] = ((df.tech == "まくり差し") & (df.self_win == 0)).astype(np.int8)

# 会場×コースの基準（学習期間だけ）
tr = df[df.d <= TRAIN_END]
bl = tr.groupby(["venue", "course"]).agg(bl_nige=("nige", "mean"), bl_makuri=("makuri", "mean"), bl_sashi=("sashi", "mean")).reset_index()
df = df.merge(bl, on=["venue", "course"], how="left")

cnt = ["n", "nige", "makuri", "sashi", "mz", "self_win", "bl_nige", "bl_makuri", "bl_sashi"]
df["n"] = 1
g = df.groupby(["racer", "course", "d"], sort=True)[cnt].sum().reset_index().sort_values(["racer", "course", "d"])
out = {}
keys = g[["racer", "course", "d"]].reset_index(drop=True)
# all: 累積から当日分を引く
cs = g.groupby(["racer", "course"])[cnt].cumsum() - g[cnt]
for c in cnt: keys[f"all_{c}"] = cs[c].values
for win in ["365D", "90D"]:
    r = (g.set_index("d").groupby(["racer", "course"])[cnt]
         .rolling(win, closed="left").sum().reset_index())
    r = r.sort_values(["racer", "course", "d"]).reset_index(drop=True)
    tag = win[:-1].lower() + "d"
    for c in cnt: keys[f"{tag}_{c}"] = r[c].fillna(0).values
feat = keys

def side(bn, course, prefix):
    s = df[(df.bn == bn) & (df.course == course)][["race_id", "d", "venue", "racer", "win_rate", "cls", "winner_bn", "second_bn", "tech", "self_win", "self_top2"]]
    s = s.merge(feat[feat.course == course].drop(columns="course"), on=["racer", "d"], how="left")
    return s.rename(columns={c: f"{prefix}{c}" for c in s.columns if c not in ("race_id", "d", "venue", "winner_bn", "second_bn", "tech")})

b1 = side(1, 1, "b1_")
b2 = side(2, 2, "b2_")
others = df[df.bn >= 3].groupby("race_id").win_rate.max().rename("max_wr_3to6").reset_index()
allmax = df[df.bn >= 2].groupby("race_id").win_rate.max().rename("max_wr_2to6").reset_index()
races = b1.merge(b2.drop(columns=["d", "venue", "winner_bn", "second_bn", "tech"]), on="race_id", how="left")
races = races.merge(others, on="race_id", how="left").merge(allmax, on="race_id", how="left")
races["b2_in_course2"] = races.b2_racer.notna()
races.to_pickle(os.path.join(W, "races.pkl"))
print(len(races), "races with boat1 in course1;", int(races.b2_in_course2.sum()), "with boat2 in course2")
print(races.d.min(), races.d.max())
