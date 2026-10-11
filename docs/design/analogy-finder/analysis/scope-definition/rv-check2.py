"""BOA-271 「集めるレース」の範囲の定義の比較（読み取りのみ。ローカルの本番DB書き出しを使う）。

艇ごとの行（レース×艇）を作り、範囲キーごとに学習期間の1着率・3着以内率を出し、検証期間の実際の結果と比べる。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ANALOGY = Path(sys.argv[1])
sys.path.insert(0, str(ANALOGY))
import v16_pool as P  # noqa: E402

SRC = Path(sys.argv[2])
CUT = pd.Timestamp(sys.argv[3] if len(sys.argv) > 3 else "2025-04-01")
OUT = Path(sys.argv[4] if len(sys.argv) > 4 else ".")
CLS = ("A1", "A2", "B1", "B2")

kb_b, _ = P.load_kb_boats(SRC)
mn_b, _ = P.load_main_boats(SRC)
b = pd.concat([kb_b, mn_b], ignore_index=True)
b["race_date"] = pd.to_datetime(b["race_date"])

# レースの条件: 6艇・欠場なし・級別が全艇そろう・1着が1艇（返還艇は「1着でない」として扱う）
g = b.groupby("race_id")
ok = (g.size() == 6) & ~g["absent"].any() & g["cls"].apply(lambda s: s.isin(CLS).all()) \
     & ((b["finish_rank"] == 1).groupby(b["race_id"]).sum() == 1)
b = b[b["race_id"].isin(ok[ok].index)].sort_values(["race_id", "boat_number"]).reset_index(drop=True)
W = b.pivot(index="race_id", columns="boat_number", values="cls")
races = b.groupby("race_id").agg(race_date=("race_date", "first"), venue=("venue_code", "first"))
cl = W.to_numpy()  # (n,6)
cnt = np.stack([(cl == k).sum(1) for k in CLS], 1)
combo = pd.Series(["-".join(map(str, r)) for r in cnt], index=W.index)
ordered = pd.Series(["".join(r) for r in cl], index=W.index)
races = races.join(combo.rename("combo")).join(ordered.rename("ordered"))

b = b.join(races[["combo", "ordered"]], on="race_id")
b["win"] = (b["finish_rank"] == 1).astype(float)
b["top3"] = (b["finish_rank"] <= 3).astype(float)
bn = b["boat_number"].to_numpy()
ri = races.index.get_indexer(b["race_id"])
clr = cl[ri]  # 艇ごとに、そのレースの6艇の級別



istr = (b["race_date"] < CUT).to_numpy(); te = b[~istr]
c1 = pd.Series(clr[:, 0], index=b.index)
sel = b["boat_number"].astype(str) + b["cls"]
K = {"a": b["combo"] + "|" + sel, "h": b["combo"] + "|" + sel + "|1=" + c1}
def rate(key, venue):
    k = (b["venue_code"].astype(str) + ":" + key) if venue else key
    g = pd.DataFrame({"k": k[istr], "w": b["win"][istr]}).groupby("k")["w"].agg(["sum", "size"])
    m = g.reindex(k[~istr].to_numpy()).fillna(0).to_numpy(); return m[:, 0], m[:, 1]
out = {}
for d, k in K.items():
    wN, nN = rate(k, False); wV, nV = rate(k, True); use = nV >= 300
    w = np.where(use, wV, wN); n = np.where(use, nV, nN); out[d] = (w, n, nV)
pa = out["a"][0] / np.maximum(out["a"][1], 1)
ph = np.where(out["h"][1] > 0, out["h"][0] / np.maximum(out["h"][1], 1), pa)
y = te["win"].to_numpy(); bn = te["boat_number"].to_numpy()
days = te["race_date"].dt.date.to_numpy(); ud, inv = np.unique(days, return_inverse=True); rng = np.random.default_rng(2)
for s in range(1, 7):
    M = bn == s; d = ((ph - y) ** 2 - (pa - y) ** 2)
    sm = np.bincount(inv[M], d[M], minlength=len(ud)); nm = np.bincount(inv[M], minlength=len(ud))
    bs = [sm[i].sum() / nm[i].sum() for i in (rng.integers(0, len(ud), len(ud)) for _ in range(500))]
    print(s, "dBrier x1e4", round(d[M].mean() * 1e4, 2), [round(np.percentile(bs, q) * 1e4, 2) for q in (2.5, 97.5)],
          "venue n median a/h", np.median(out["a"][2][M]), np.median(out["h"][2][M]), "venue<300 a/h", round((out["a"][2][M] < 300).mean(), 3), round((out["h"][2][M] < 300).mean(), 3),
          "NC<300 h", round((out["h"][1][M] < 300).mean(), 3))
