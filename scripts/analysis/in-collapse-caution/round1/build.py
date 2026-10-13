"""features.py（BOA-271）で艇の行を作り、実進入コースを付けてスクラッチに保存する。読み取りのみ"""
import sys, time
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, "/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/ml/analogy")
import features as F
S = Path(__file__).parent; POOL = S / "pool"
t = time.time()
df, _ = F.build_with_maps(POOL)
print("built", len(df), time.time() - t, flush=True)
# 実進入コース
kb = pd.read_csv(POOL / "kb_boats.csv", usecols=["race_id", "boat_number", "course"])
kb["race_id"] = F.rid_to_int(kb["race_id"])
res = pd.read_csv(POOL / "results.csv", usecols=["race_id"] + [f"actual_course_{i}" for i in range(1, 7)])
res["race_id"] = F.rid_to_int(res["race_id"])
m = res.melt(id_vars="race_id", var_name="b", value_name="course")
m["boat_number"] = m["b"].str[-1].astype(int)
m = m.drop(columns="b")
kb = kb[kb["race_id"] < m["race_id"].min()] if len(m) else kb
crs = pd.concat([kb, m[["race_id", "boat_number", "course"]]]).drop_duplicates(["race_id", "boat_number"], keep="last")
df = df.merge(crs, on=["race_id", "boat_number"], how="left")
df.to_pickle(S / "boats.pkl")
print("saved", df.shape, df["course"].notna().mean())
