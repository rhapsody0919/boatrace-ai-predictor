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


def keyfn(name):
    """艇ごとの範囲キー（会場を含まない部分）"""
    sel = b["boat_number"].astype(str) + b["cls"]
    if name == "a_combo_sel":       # 今: 構成＋選んだ艇の艇番・級
        return b["combo"] + "|" + sel
    if name == "b_ordered":         # 6枠すべて同じ級（選んだ艇の艇番を付ける）
        return b["ordered"] + "|" + b["boat_number"].astype(str)
    if name == "c_in3_sel":         # 1〜3号艇は枠ごと＋選んだ艇＋残りは艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            fixed = {1, 2, 3, s}
            rest = [r[i] for i in range(6) if i + 1 not in fixed]
            out.append("".join(r[i] if i + 1 in fixed else "_" for i in range(6)) + "|" +
                       "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "d_nbr_sel":         # 選んだ艇と隣の枠は枠ごと＋残りは艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            fixed = {s - 1, s, s + 1} & set(range(1, 7))
            rest = [r[i] for i in range(6) if i + 1 not in fixed]
            out.append("".join(r[i] if i + 1 in fixed else "_" for i in range(6)) + "|" +
                       "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "e_inner_sel":       # 選んだ艇より内の枠は枠ごと＋選んだ艇＋外は艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            rest = [r[i] for i in range(s, 6)]
            out.append("".join(r[:s]) + "|" + "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "x_combo":           # 参考: 構成だけ（選んだ艇の級を問わない）
        return b["combo"] + "|" + b["boat_number"].astype(str)
    if name == "y_sel":             # 参考: 選んだ艇の艇番・級だけ
        return sel
    raise ValueError(name)



DEFS = ["a_combo_sel", "c_in3_sel", "d_nbr_sel", "e_inner_sel", "b_ordered"]
keys = {d: keyfn(d) for d in DEFS}
pd.set_option("display.width", 250)

# 1. 件数: 2026-09-05〜10-05 のレースを「今日」とし、それより前の全期間（2019-04〜2026-09-04）を集める
T0 = pd.Timestamp("2026-09-05")
pool = (b["race_date"] < T0).to_numpy(); today = ~pool
rows = []
for d in DEFS:
    for scope in ("NC", "VC"):
        full = (b["venue_code"].astype(str) + ":" + keys[d]) if scope == "VC" else keys[d]
        vc = full[pool].value_counts()
        n = vc.reindex(full[today].to_numpy()).fillna(0)
        rows.append({"def": d, "scope": scope, "median": n.median(), "p10": n.quantile(.1), "lt300": (n < 300).mean(),
                     "lt100": (n < 100).mean(), "lt30": (n < 30).mean()})
        if d == "a_combo_sel":
            pass
print("## 件数（今日=2026-09-05〜10-05 の艇の行、集める=それより前の全期間）")
print(pd.DataFrame(rows).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
# 切り替え後の件数: (a) VC300>NC と、(b)〜(e) の NC で300件未満の割合を1号艇・全艇で
for d in DEFS:
    ncn = keys[d][pool].value_counts().reindex(keys[d][today].to_numpy()).fillna(0).to_numpy()
    b1 = (b.loc[today, "boat_number"] == 1).to_numpy()
    print(d, "NC<300 全艇", round((ncn < 300).mean(), 3), "1号艇", round((ncn[b1] < 300).mean(), 3))

# 2. (a) の範囲の中で、枠の並びを分けると1着率が本当にどれだけ違うか（学習期間・全国）
CUT2 = CUT
tr = (b["race_date"] < CUT2).to_numpy()
for target in ("win", "top3"):
    for d in DEFS[1:]:
        df = pd.DataFrame({"a": keys["a_combo_sel"][tr], "f": keys[d][tr], "y": b[target][tr]})
        g = df.groupby(["a", "f"])["y"].agg(["size", "mean"]).reset_index()
        pa = df.groupby("a")["y"].mean()
        g["pa"] = g["a"].map(pa)
        g = g[g["size"] >= 30]
        dev = g["mean"] - g["pa"]
        w = g["size"]
        var_obs = np.average(dev ** 2, weights=w)
        var_samp = np.average(g["pa"] * (1 - g["pa"]) / g["size"], weights=w)
        sig = np.sqrt(max(0.0, var_obs - var_samp)) * 100
        # 細かい範囲ごとの差が、標本の揺れを超えて5pt以上ある（|dev| - 2SE >= 5pt）割合（艇の行で重み付け）
        se = np.sqrt(g["pa"] * (1 - g["pa"]) / g["size"])
        big = ((dev.abs() - 2 * se) >= 0.05)
        print(f"{target} {d}: 真の差の標準偏差（標本の揺れを引いた推定）={sig:.2f}pt  観測の差の標準偏差={np.sqrt(var_obs)*100:.2f}pt"
              f"  2SEを超えて5pt以上違う範囲の行の割合={np.average(big, weights=w):.3f}  (n>=30 の範囲の行の割合 {w.sum()/tr.sum():.3f})")

# 3. 例: 構成 4-2-0-0（A1が4艇・A2が2艇）で1号艇がA1。枠の並びごとの1号艇の1着率（全期間・全国）
m = (b["combo"] == "4-2-0-0") & (b["boat_number"] == 1) & (b["cls"] == "A1")
ex = b[m].groupby("ordered").agg(n=("win", "size"), win=("win", "mean"), top3=("top3", "mean")).sort_values("n", ascending=False)
print("\n## 例: A1が4艇・A2が2艇・1号艇A1（全国・2019-04〜2026-10-05）。並び別の1号艇")
print(ex.assign(win=lambda x: (x.win*100).round(1), top3=lambda x: (x.top3*100).round(1)).to_string())
print("合計", int(ex.n.sum()), "1着率", round(b[m].win.mean()*100, 1))
# 例2: 1号艇B1、2号艇がA1 か B1 か（構成と選んだ艇の級をそろえた中で）
for combo in ("1-1-4-0", "2-1-3-0", "1-2-3-0"):
    m = (b["combo"] == combo) & (b["boat_number"] == 1) & (b["cls"] == "B1")
    t = b[m].copy(); t["c2"] = clr[m.to_numpy()][:, 1]
    print(f"\n## 例: 構成 {combo}（A1-A2-B1-B2 の艇数）・1号艇B1。2号艇の級別ごとの1号艇の率（全国・全期間）")
    print(t.groupby("c2").agg(n=("win", "size"), win=("win", "mean"), top3=("top3", "mean")).round(3).to_string())
