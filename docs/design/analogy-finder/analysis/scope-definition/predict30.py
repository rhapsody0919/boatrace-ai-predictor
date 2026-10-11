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



# 30件前後の「会場×6枠の並び」の率で、その後のレースをどれだけ当てられるか。艇番ごと
c1 = pd.Series(clr[:, 0], index=b.index)
b["nat_a"] = b["combo"] + "|" + b["boat_number"].astype(str) + b["cls"]
b["nat_h"] = b["nat_a"] + "|1=" + c1
b["nat_b"] = b["ordered"] + "|" + b["boat_number"].astype(str)
b["ven_b"] = b["venue_code"].astype(str) + ":" + b["nat_b"]
b = b.sort_values("race_date").reset_index(drop=True)
cum = {}
for col in ("nat_a", "nat_h", "nat_b"):
    d = {}
    for k, x in b.groupby(col):
        d[k] = (x["race_date"].to_numpy(), np.concatenate([[0], np.cumsum(x["win"].to_numpy())]))
    cum[col] = d
def before(col, key, date):
    dates, cw = cum[col][key]
    i = np.searchsorted(dates, np.datetime64(date), side="left")
    return (cw[i] / i * 100 if i > 0 else np.nan), i
rows = []
for k, x in b.groupby("ven_b"):
    n = len(x)
    if not (40 <= n <= 60):
        continue
    h = n // 2; old = x.iloc[:h]; new = x.iloc[h:]
    d0 = new["race_date"].iloc[0]; r0 = new.iloc[0]
    pa, na = before("nat_a", r0["nat_a"], d0); ph, nh = before("nat_h", r0["nat_h"], d0); pb, nb = before("nat_b", r0["nat_b"], d0)
    rows.append({"boat": int(r0["boat_number"]), "new": new["win"].mean()*100, "own30": old["win"].mean()*100,
                 "a": pa, "h": ph, "bn": pb, "na": na, "nh": nh, "nb": nb})
R = pd.DataFrame(rows).dropna()
print("集まり（会場×6枠の並び、40〜60件、古い半分で新しい半分を当てる）", len(R))
out = []
for bt, g in R.groupby("boat"):
    e = lambda c: (g[c] - g["new"]).abs().mean()
    out.append({"艇": bt, "集まり": len(g), "後半の1着率 平均": g["new"].mean(),
                "会場×並び同じ 前半30件": e("own30"), "今のやり方 全国": e("a"), "＋1号艇の級 全国": e("h"), "並び同じ 全国": e("bn"),
                "件数 今": g["na"].median(), "件数 ＋1号艇": g["nh"].median(), "件数 並び全国": g["nb"].median()})
print(pd.DataFrame(out).round(1).to_string(index=False))
e = lambda c: (R[c] - R["new"]).abs().mean()
print("全艇", {c: round(e(c), 1) for c in ("own30", "a", "h", "bn")})
