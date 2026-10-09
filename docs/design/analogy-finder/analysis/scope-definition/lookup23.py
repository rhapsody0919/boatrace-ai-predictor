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
# 1. 例の並び（A1 A2 A1 A1 A2 A1）の会場ごと
ex = "A1A2A1A1A2A1"
e = b1[b1["ordered"] == ex]
a = b1[(b1["combo"] == "4-2-0-0") & (b1["cls"] == "A1")]
t = e.groupby("venue_code")["win"].agg(["size", "sum"]).rename(columns={"size": "n", "sum": "w"})
ta = a.groupby("venue_code")["win"].agg(["size", "sum"]).rename(columns={"size": "na", "sum": "wa"})
t = t.join(ta)
t["rate"] = t.w / t.n * 100; t["rate_a"] = t.wa / t.na * 100
t.index = [VN[int(i)] for i in t.index]
print("例の並び", ex, "全国", len(e), "件 1号艇1着率", round(e.win.mean()*100, 1), "／今のやり方 全国", len(a), round(a.win.mean()*100, 1))
print(t.sort_values("n", ascending=False).round(1).to_string())
out["example"] = {"ordered": ex, "nat_n": int(len(e)), "nat_rate": round(e.win.mean()*100, 1), "nat_a_n": int(len(a)), "nat_a_rate": round(a.win.mean()*100,1),
                  "venues": [{"venue": i, "n": int(r.n), "w": int(r.w), "rate": round(r.rate,1), "na": int(r.na), "rate_a": round(r.rate_a,1)} for i, r in t.iterrows()]}
# 2. 答え合わせ: 会場×6枠の並びが20〜30件の集まりを、古い半分と新しい半分に分けて1号艇の1着率を比べる
def halves(df, key, lo, hi):
    g = df.sort_values("race_date").groupby(key)
    rows = []
    for k, x in g:
        n = len(x)
        if lo <= n <= hi:
            h = n // 2
            rows.append((x.win.iloc[:h].mean()*100, x.win.iloc[h:].mean()*100, n))
    return pd.DataFrame(rows, columns=["old", "new", "n"])
h23 = halves(b1, "vkey_o", 40, 60)   # 半分が約20〜30件
hA = halves(b1, "vkey_a", 600, 2000)  # 半分が300件以上（今のやり方の会場）
for name, h in (("会場×6枠の並び（半分が20〜30件）", h23), ("今のやり方の会場（半分が300件以上）", hA)):
    d = (h.new - h.old).abs()
    print(name, "集まり", len(h), "古い半分と新しい半分の差 平均", round(d.mean(), 1), "pt 中央値", round(d.median(), 1), "10pt以上の割合", round((d >= 10).mean(), 3), "相関", round(h.old.corr(h.new), 2))
out["halves"] = {"small": h23.round(1).values.tolist(), "big": hA.round(1).values.tolist()}
json.dump(out, open("lookup23.json", "w"), ensure_ascii=False)
