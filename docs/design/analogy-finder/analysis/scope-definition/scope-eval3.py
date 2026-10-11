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



# レース単位（タブ3: 選んだ艇＝1号艇）。目的: 1着艇の分布（6値）と、枠なりのレースのスリットの形（カド一撃・ダッシュ勢先行・2コース凹み・3コース凹み）
sys.path.insert(0, str(ANALOGY))
import v16_defs as Dd
rc = races.copy()
win_boat = b[b["win"] == 1].set_index("race_id")["boat_number"]
rc["winner"] = win_boat.reindex(rc.index).astype(int)
C = pd.DataFrame(cl, index=W.index, columns=range(1, 7))
def k_rest(fixed):
    out = []
    for r in cl:
        rest = [r[i] for i in range(6) if i + 1 not in fixed]
        out.append("".join(r[i] if i + 1 in fixed else "_" for i in range(6)) + "|" + "-".join(str(rest.count(c)) for c in CLS))
    return pd.Series(out, index=W.index)
KEYS = {"a_combo_sel1": rc["combo"] + "|" + C[1],
        "c_in3": k_rest({1, 2, 3}),
        "f_1and4": k_rest({1, 4}),
        "g_in4": k_rest({1, 2, 3, 4}),
        "b_ordered": rc["ordered"]}
# 枠なり・6艇の ST がそろうレースのスリットの形
cw = b.pivot(index="race_id", columns="boat_number", values="course").reindex(rc.index)
sw = b.assign(st2=b["st"].where(~b["returned"])).pivot(index="race_id", columns="boat_number", values="st2").reindex(rc.index)
waku = (cw.to_numpy() == np.arange(1, 7)).all(1) & ~np.isnan(sw.to_numpy()).any(1)
forms = Dd.slit_forms_matrix(np.round(sw.to_numpy(), 2))
tr = (rc["race_date"] < CUT).to_numpy(); te = ~tr
Y = np.eye(6)[rc["winner"].to_numpy() - 1]
pd.set_option("display.width", 250)
res = []
for scope in ("NC", "VC300>NC"):
    par = None
    for d, k in KEYS.items():
        kn = k; kv = rc["venue"].astype(str) + ":" + k
        def dist(key, mask):
            df = pd.DataFrame(Y[mask], index=key[mask].to_numpy())
            g = df.groupby(level=0); return g.sum(), g.size()
        sN, nN = dist(kn, tr); sV, nV = dist(kv, tr)
        nn = nN.reindex(kn[te].to_numpy()).fillna(0).to_numpy(); ss = sN.reindex(kn[te].to_numpy()).fillna(0).to_numpy()
        if scope == "VC300>NC":
            nv = nV.reindex(kv[te].to_numpy()).fillna(0).to_numpy(); sv = sV.reindex(kv[te].to_numpy()).fillna(0).to_numpy()
            use = nv >= 300
            nn = np.where(use, nv, nn); ss = np.where(use[:, None], sv, ss)
        if d == "a_combo_sel1":
            par = ss / np.maximum(nn, 1)[:, None]
        raw = np.where(nn[:, None] > 0, ss / np.maximum(nn, 1)[:, None], par)
        shr = (ss + 100 * par) / (nn + 100)[:, None]
        y = Y[te]
        row = {"scope": scope, "def": d, "median_n": np.median(nn), "lt300": (nn < 300).mean(), "lt30": (nn < 30).mean(),
               "brier_raw": ((raw - y) ** 2).sum(1).mean(), "brier_shr": ((shr - y) ** 2).sum(1).mean(),
               "ll_shr": -np.log(np.clip((shr * y).sum(1), 1e-6, 1)).mean()}
        # スリットの形（枠なり・ST がそろうレースだけ）
        for f in ("kado", "dash", "d2", "d3"):
            yy = forms[f].astype(float)
            mtr = tr & waku; mte = te & waku
            df = pd.DataFrame({"k": (kv if scope != "NC" else kn), "kn": kn, "y": yy})
            gN = df[mtr].groupby("kn")["y"].agg(["sum", "size"])
            gV = df[mtr].groupby("k")["y"].agg(["sum", "size"])
            tn = gN.reindex(df.loc[mte, "kn"].to_numpy()).fillna(0).to_numpy()
            if scope == "VC300>NC":
                tv = gV.reindex(df.loc[mte, "k"].to_numpy()).fillna(0).to_numpy()
                tn = np.where((tv[:, 1] >= 300)[:, None], tv, tn)
            if d == "a_combo_sel1":
                row_par = tn[:, 0] / np.maximum(tn[:, 1], 1); globals()[f"par_{f}_{scope}"] = row_par
            pp = globals()[f"par_{f}_{scope}"]
            rr = np.where(tn[:, 1] > 0, tn[:, 0] / np.maximum(tn[:, 1], 1), pp)
            sh = (tn[:, 0] + 100 * pp) / (tn[:, 1] + 100)
            yt = yy[mte]
            row[f"{f}_raw"] = ((rr - yt) ** 2).mean() * 1e4; row[f"{f}_shr"] = ((sh - yt) ** 2).mean() * 1e4
        res.append(row)
R = pd.DataFrame(res)
print("レース単位（選んだ艇=1号艇）。brier は6値の合計。スリットの形の列は Brier×1e4（枠なり・ST がそろう検証期間のレース）")
print(R.to_string(index=False, float_format=lambda v: f"{v:.5f}"))
print("waku test races", int((te & waku).sum()), "base rates", {f: round(forms[f][te & waku].mean(), 4) for f in ("kado","dash","d2","d3")})
# 日単位ブートストラップ: 1着艇の分布の Brier（生）の差、今(a)との比較、VC300>NC
