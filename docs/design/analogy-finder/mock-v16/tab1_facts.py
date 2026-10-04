"""BOA-271 v16 タブ①: 範囲（若松の全レース・若松の全艇A1・全国の全艇A1）ごとに、
艇番×材料×6艇中の順位で着内率を数える（数えた値）。
第8回の検証の指摘4に合わせ、同じ値の艇は「一番良い」「一番悪い」の両方で含める:
  top: その艇の値が6艇の最良と同じ（min 順位＝1）
  bottom: その艇の値が6艇の最悪と同じ（同じ値の最下位も含む）
  中間 2〜5: min 順位（既存の *_rank 列と同じ）
欠損の艇は数えない。データ: knn/work2（母集団 2019-04-01〜2026-09-26）
series_score（今節の得点率、高いほど良い）は series_score.py の行から races.pkl の並びに載せる（series-score.md）
"""
import json
from pathlib import Path
import numpy as np, pandas as pd
K = Path(__file__).resolve().parent.parent / "knn" / "work2"
r = pd.read_pickle(K / "races.pkl"); B = dict(np.load(K / "boats.npz"))
pool = r["is_pool"].to_numpy()
venue = r["venue_code"].astype(int).to_numpy()
a1 = (B["cls_ord"] == 4).all(1)
# 今節の得点率: series_score.py の行（race_id×艇番）を races.pkl の並びに載せ、6艇中の順位（同値は良い方）を付ける
SR = pd.read_pickle(Path(__file__).resolve().parent / "series_score_rows.pkl")
ss = np.full((len(r), 6), np.nan)
pos_of = pd.Series(np.arange(len(r)), index=r["race_id"].to_numpy())
sub = SR[SR["race_id"].isin(pos_of.index)]
ss[pos_of[sub["race_id"]].to_numpy(), sub["boat_number"].astype(int).to_numpy() - 1] = sub["value"].to_numpy()
B["series_score"] = ss
B["series_score_rank"] = pd.DataFrame(ss).rank(axis=1, method="min", ascending=False).to_numpy()
ranks = np.stack([r["rank1"], r["rank2"], r["rank3"]], 1)
fin = {}
for b in range(1, 7):
    fin[b] = {"win": ranks[:, 0] == b,
              "top2": (ranks[:, :2] == b).any(1),
              "top3": (ranks[:, :3] == b).any(1)}
MATS = [("nat_win", 1), ("loc_win", 1), ("recent_win30", 1), ("motor_2", 1), ("boat_2", 1), ("st_mean30", -1), ("exh_time", -1), ("series_score", 1)]
SCOPES = {"wk": pool & (venue == 20), "wkA1": pool & (venue == 20) & a1, "natA1": pool & a1, "natA1Y": pool & a1 & (r["round"].to_numpy() == "yusho")}
out = {"period": ["2019-04-01", "2026-09-26"], "scopes": {}}
for sk, m in SCOPES.items():
    S = {"n": int(m.sum()), "usual": {}, "by": {}, "typ": {}}
    for b in range(1, 7):
        S["usual"][b] = {t: [int((fin[b][t] & m).sum()), int(m.sum())] for t in ("win", "top2", "top3")}
        S["by"][b] = {}; S["typ"][b] = {}
        for mat, sgn in MATS:
            v = B[mat].astype(float); rk = B[mat + "_rank"].astype(float)
            ok = ~np.isnan(v[:, b - 1])
            worst = np.nanmin(v * sgn, axis=1) * sgn
            best = np.nanmax(v * sgn, axis=1) * sgn
            vb = v[:, b - 1]
            buckets = {"1": ok & np.isclose(vb, best), "6": ok & np.isclose(vb, worst)}
            for k in range(2, 6):
                buckets[str(k)] = ok & (rk[:, b - 1] == k)
            S["by"][b][mat] = {k: {t: [int((s & m & fin[b][t]).sum()), int((s & m).sum())] for t in ("win", "top2", "top3")} for k, s in buckets.items()}
            S["typ"][b][mat] = {t: (float(np.nanmean(rk[m & fin[b][t] & ok, b - 1])) if (m & fin[b][t] & ok).any() else None) for t in ("win", "top2", "top3")}
    out["scopes"][sk] = S
    print(sk, S["n"], "4号艇 全国勝率 1着 top/bottom", S["by"][4]["nat_win"]["1"]["win"], S["by"][4]["nat_win"]["6"]["win"])
# 欠損の割合（範囲ごと・艇番ごと）
out["series_missing"] = {sk: {"all": [int((np.isnan(ss) & m[:, None]).sum()), int(m.sum()) * 6],
                              "by_boat": {b: [int((np.isnan(ss[:, b - 1]) & m).sum()), int(m.sum())] for b in range(1, 7)},
                              "races_all6": [int((~np.isnan(ss).any(1) & m).sum()), int(m.sum())]}
                         for sk, m in SCOPES.items()}
# 例のレース（2026-09-27 若松12R 優勝戦。母集団の外なので行から直接取る）
exr = SR[SR["race_id"] == 202609272012].sort_values("boat_number")
exv = pd.Series(exr["value"].to_numpy(), index=exr["boat_number"].astype(int).to_numpy())
exk = exv.rank(method="min", ascending=False)
out["ex_series"] = {int(b): {"value": (None if np.isnan(v) else round(float(v), 2)), "rank": (None if np.isnan(v) else int(exk[b]))} for b, v in exv.items()}
print("ex_series", out["ex_series"]); print("series_missing", out["series_missing"])
(Path(__file__).resolve().parent / "tab1.json").write_text(json.dumps(out, ensure_ascii=False))
