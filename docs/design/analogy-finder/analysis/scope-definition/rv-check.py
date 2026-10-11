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



rc = races.copy()
win_boat = b[b["win"] == 1].set_index("race_id")["boat_number"]
rc["winner"] = win_boat.reindex(rc.index).astype(int)
C = pd.DataFrame(cl, index=W.index, columns=range(1, 7))
tr = (rc["race_date"] < CUT).to_numpy(); te = ~tr
Y = np.eye(6)[rc["winner"].to_numpy() - 1]
y = Y[te]
def race_pool(key):
    df = pd.DataFrame(Y[tr], index=key[tr].to_numpy()); g = df.groupby(level=0)
    s, n = g.sum(), g.size()
    nn = n.reindex(key[te].to_numpy()).fillna(0).to_numpy(); ss = s.reindex(key[te].to_numpy()).fillna(0).to_numpy()
    return ss, nn
sa, na = race_pool(rc["combo"] + "|" + C[1]); pa = sa / np.maximum(na, 1)[:, None]
sb, nb = race_pool(rc["ordered"])
pb_raw = np.where(nb[:, None] > 0, sb / np.maximum(nb, 1)[:, None], pa)
pb_shr = (sb + 100 * pa) / (nb + 100)[:, None]
# own-class baseline: boat-level a key (combo|boat+cls) for each of 6 boats, normalized
bk = b["combo"] + "|" + b["boat_number"].astype(str) + b["cls"]
istr = (b["race_date"] < CUT).to_numpy()
agg = pd.DataFrame({"k": bk[istr], "w": b["win"][istr]}).groupby("k")["w"].mean()
bt = b[~istr]
pr = agg.reindex(bk[~istr].to_numpy()).to_numpy()
P6 = pd.DataFrame({"race_id": bt["race_id"].to_numpy(), "bn": bt["boat_number"].to_numpy(), "p": pr}).pivot(index="race_id", columns="bn", values="p").reindex(rc.index[te]).to_numpy()
P6 = np.where(np.isnan(P6), pa, P6)
ssum = P6.sum(1, keepdims=True); print("zero-sum races", int((ssum[:,0]<=0).sum()), "nan", int(np.isnan(ssum).sum())); P6n = np.where(ssum > 0, P6 / np.where(ssum>0, ssum, 1), 1/6)
def br(p): return ((p - y) ** 2).sum(1)
def lg(p): return -np.log(np.clip((p * y).sum(1), 1e-6, 1))
for name, p in [("a_race(combo|C1)", pa), ("own_cls_each_boat_norm", P6n), ("own_cls_unnorm", P6), ("b_raw", pb_raw), ("b_shr", pb_shr)]:
    print(name, round(br(p).mean(), 5), round(lg(np.clip(p,1e-6,1)).mean(), 4))
# day bootstrap of brier diffs
days = rc["race_date"][te].dt.date.to_numpy(); ud, inv = np.unique(days, return_inverse=True)
rng = np.random.default_rng(1)
def boot(d):
    s = np.bincount(inv, d); n = np.bincount(inv)
    bs = [ (s[i].sum() / n[i].sum()) for i in (rng.integers(0, len(ud), len(ud)) for _ in range(500))]
    return d.mean(), np.percentile(bs, 2.5), np.percentile(bs, 97.5)
print("b_shr - a", boot(br(pb_shr) - br(pa)))
print("b_raw - a", boot(br(pb_raw) - br(pa)))
print("b_shr - own_norm", boot(br(pb_shr) - br(P6n)))
print("own_norm - a", boot(br(P6n) - br(pa)))
# boat1 component only
print("boat1 comp a, b_raw, b_shr, own", [round(((p[:,0]-y[:,0])**2).mean(),5) for p in (pa,pb_raw,pb_shr,P6n)])
