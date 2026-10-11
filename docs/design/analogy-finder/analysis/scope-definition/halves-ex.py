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



import json
b1 = b[b["boat_number"] == 1].copy()
b1["vkey_o"] = b1["venue_code"].astype(str) + ":" + b1["ordered"]
b1["vkey_a"] = b1["venue_code"].astype(str) + ":" + b1["combo"] + ":" + b1["cls"]
VN = {1:"桐生",2:"戸田",3:"江戸川",4:"平和島",5:"多摩川",6:"浜名湖",7:"蒲郡",8:"常滑",9:"津",10:"三国",11:"びわこ",12:"住之江",13:"尼崎",14:"鳴門",15:"丸亀",16:"児島",17:"宮島",18:"徳山",19:"下関",20:"若松",21:"芦屋",22:"福岡",23:"唐津",24:"大村"}
out = {}

def ex(key, lo, hi, k=6):
    rows=[]
    for kk, x in b1.sort_values("race_date").groupby(key):
        n=len(x)
        if lo<=n<=hi:
            h=n//2; o=x.iloc[:h]; nw=x.iloc[h:]
            rows.append((kk,n,str(o.race_date.min().date()),str(o.race_date.max().date()),h,int(o.win.sum()),round(o.win.mean()*100,1),
                         str(nw.race_date.min().date()),str(nw.race_date.max().date()),n-h,int(nw.win.sum()),round(nw.win.mean()*100,1)))
    df=pd.DataFrame(rows,columns="key n o_from o_to o_n o_w o_rate n_from n_to n_n n_w n_rate".split())
    df["diff"]=(df.n_rate-df.o_rate).abs()
    return df
s=ex("vkey_o",40,60); a=ex("vkey_a",600,2000)
pd.set_option("display.width",250)
print(s.sort_values("n",ascending=False).head(3).to_string()); print(s[(s["diff"]>8)&(s["diff"]<12)].head(5).to_string())
print(a[(a["diff"]>2)&(a["diff"]<4)].head(3).to_string())
