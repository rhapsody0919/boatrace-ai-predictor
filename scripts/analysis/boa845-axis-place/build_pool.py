"""BOA-845 母集団の準備: boats.pkl と load_races（tab3_ok・1〜3着）をレースごとの1行にして work/pool.pkl に書く。
範囲キーは scripts/ml/analogy の v16_defs・v16_morning.scope_masks と同じ定義で数える。

入力: 環境変数 ANALOGY_DATA_DIR（必須）。scripts/ml/analogy/export_pool.js の CSV と features.py の boats.pkl があるフォルダ。
  2026-10-12 の検証は 2026-10-01 時点の書き出し（2019-04-01〜2026-10-01）を使った
使い方: ANALOGY_DATA_DIR=/path/to/data/ml/analogy scripts/ml/.venv/bin/python scripts/analysis/boa845-axis-place/build_pool.py
"""
import os, sys, time
from pathlib import Path
import numpy as np, pandas as pd

if not os.environ.get("ANALOGY_DATA_DIR"):
    sys.exit("ANALOGY_DATA_DIR を指定する（export_pool.js と features.py の出力があるフォルダ）")
D = Path(os.environ["ANALOGY_DATA_DIR"])
from common import WORK  # noqa: E402  sys.path に scripts/ml/analogy を足す
import v16_pool as P, features as F  # noqa: E402

t = time.time()
# 10/1 の書き出しは v16 の列（払戻・決まり手・実進入など一部）を持たない。件数と1〜3着だけ使うので、無い列は NaN で埋める
_orig = P._csv
def _csv(src, name, cols):
    have = set(pd.read_csv(src / f"{name}.csv", nrows=0).columns)
    miss = [c for c in cols if c not in have]
    if miss: print("missing", name, miss, flush=True)
    df = _orig(src, name, [c for c in cols if c in have])
    for c in miss: df[c] = np.nan
    return df
P._csv = _csv
b = pd.read_pickle(D / "boats.pkl")[["race_id", "boat_number", "cls", "race_date", "venue_code", "round", "grade", "race_ok"]]
w = b.pivot(index="race_id", columns="boat_number", values="cls").reindex(columns=range(1, 7))
w.columns = [f"c{i}" for i in range(1, 7)]
meta = b.groupby("race_id")[["race_date", "venue_code", "round", "grade", "race_ok"]].first()
RJ = {"予選": "yosen", "準優勝戦": "junyu", "優勝戦": "yusho", "その他": "other"}
meta["round"] = meta["round"].map(RJ)
print("pkl", len(meta), time.time() - t, flush=True)
r = P.load_races(D)
r["rid"] = F.rid_to_int(r["race_id"].astype(str))
# 本体（2025-12-03〜）は 10/1 の書き出しに実進入（actual_course_N）が無く course_known が全て False になる。
# 本体だけ course_known を条件から外す（他の条件 = 6艇・欠場なし・返還なし・1〜3着ありは同じ）
main = pd.to_datetime(r["race_date"]) > F.KB_END
print("tab3_ok main before", int((r["tab3_ok"] & main).sum()), "main", int(main.sum()), flush=True)
alt = ((r["n_boats"] == 6) & ~r["has_absent"].astype(bool) & ~r["returned_top3"].astype(bool) & (r["n_win"] == 1)
       & r["has_r2"] & r["has_r3"] & (r["n_ret"] == 0))
r["tab3_ok"] = np.where(main, alt, r["tab3_ok"])
print("tab3_ok main after", int((r["tab3_ok"] & main).sum()), flush=True)
r = r.set_index("rid")[["tab3_ok", "rank1", "rank2", "rank3"]]
print("races", len(r), int(r["tab3_ok"].sum()), time.time() - t, flush=True)
out = meta.join(w).join(r, how="inner")
out = out[out["tab3_ok"].astype(bool) & out["race_ok"].astype(bool)].drop(columns=["tab3_ok", "race_ok"])
for k in ("rank1", "rank2", "rank3"):
    out[k] = out[k].astype(int)
WORK.mkdir(parents=True, exist_ok=True)
out.reset_index().to_pickle(WORK / "pool.pkl")
print("pool", len(out), out["race_date"].min(), out["race_date"].max())
