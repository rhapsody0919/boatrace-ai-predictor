#!/usr/bin/env python3
"""BOA-1280 追加の問い: /today の「逃がしやすい選手」（generate-morning-digest.js の nigashi、当日の2号艇）に当たったレースで、
1号艇の1着・2連対は、1号艇の級×勝率をそろえてどれだけ上がるか。

  python3 -I scripts/analysis/nigashi-makurare/today-nigashi-hit.py [work_dir] [out_json]

抽出の再現（src/utils/digestMetrics.js: MIN_RUNS=10・EXTRACTION_THRESHOLDS.nigashi=22、098 の compute_racer_course_technique_stats）
- 対象は枠番2の選手（当日の進入は問わない。朝は枠番しか分からないため）。成績は本人の「実進入2コース」の過去の走
- 当たり: 2コースの走数 >= 10 かつ 逃がし率 − 期待値 >= 22pt
- 1号艇の結果は枠番1（実進入は問わない）

2つの版
- M（本番の再現）: 2025-12-03〜2026-11-03。窓は DB と同じく 2025-12-02 からレースの前日までの累積。
  期待値は 098 と同じ会場×グレード×コースの率（セルの走数が100未満は会場×ALL へ）。基準の率は本体の期間全体から作る
  （098 も窓全体の基準を各走に当てるので同じ。会場の率なので後出しの影響は小さい）
- L（長期、グレード無し）: 検証 2024-01-01〜2026-11-03。窓は直近365日（当日を含まない）。期待値は 2019-04〜2023-12 の会場×コース
  （kb_archive にグレードの列が無いため代用）
そろえ方: 層 = 1号艇の級×全国勝率0.5刻み（主）／さらに2号艇の全国勝率0.5刻み（副）。層の中の当たり−外れの差を件数の重みで平均（MH 型のリスク差）、
正規近似の95%区間。層の中に当たり・外れが各5件以上ある層だけ使う
"""
import sys, os, json, datetime, hashlib
import numpy as np, pandas as pd

W = sys.argv[1] if len(sys.argv) > 1 else "data/analysis/nigashi-makurare/work"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/analysis/nigashi-makurare/today-nigashi-hit.json"
MIN_RUNS, TH = 10, 0.22
df = pd.read_csv(os.path.join(W, "runs.tsv"), sep="\t", dtype={"race_id": str, "cls": str, "tech": str})
df["d"] = pd.to_datetime(df["d"])
gr = pd.read_csv(os.path.join(W, "race-grades.tsv"), sep="\t", dtype=str)
df = df.merge(gr, on="race_id", how="left")
df["nige"] = (df.tech == "逃げ").astype(float)

def rolling_course2(sub, bl_col, mode):
    """sub: 2コースに入った走（bl_col 付き）。(racer, d) ごとの前日までの n・逃がし数・期待値の和"""
    a = sub.groupby(["racer", "d"]).agg(n=("nige", "size"), k=("nige", "sum"), e=(bl_col, "sum")).reset_index().sort_values(["racer", "d"])
    if mode == "cum":
        cs = a.groupby("racer")[["n", "k", "e"]].cumsum() - a[["n", "k", "e"]]
        a[["pn", "pk", "pe"]] = cs.values
    else:
        r = a.set_index("d").groupby("racer")[["n", "k", "e"]].rolling("365D", closed="left").sum().reset_index().sort_values(["racer", "d"])
        a[["pn", "pk", "pe"]] = r[["n", "k", "e"]].fillna(0).values
    return a[["racer", "d", "pn", "pk", "pe"]]

def adj(T, hit, y, strata):
    num = var = ws = 0.0; used = 0
    for _, s in T.groupby(strata):
        h, l = s[s[hit]][y], s[~s[hit]][y]
        if len(h) < 5 or len(l) < 5: continue
        w = len(h) * len(l) / (len(h) + len(l)); num += w * (h.mean() - l.mean()); ws += w; used += len(h)
        var += w**2 * (h.mean()*(1-h.mean())/len(h) + l.mean()*(1-l.mean())/len(l))
    d = num / ws; se = np.sqrt(var) / ws
    return {"diff": round(float(d), 4), "ci95": [round(float(d - 1.96*se), 4), round(float(d + 1.96*se), 4)], "z": round(float(d/se), 2), "hits_in_used_strata": int(used)}

def evaluate(races, label, period):
    T = races.copy()
    T["band1"] = np.floor(T.b1_wr.astype(float) * 2); T["band2"] = np.floor(T.b2_wr.astype(float) * 2)
    T["y_win"] = (T.winner_bn == 1).astype(float); T["y_top2"] = ((T.winner_bn == 1) | (T.second_bn == 1)).astype(float)
    E = T[T.eligible]
    res = {"label": label, "period": period, "races_boat2_with_runs_ge10": int(len(E)), "hits": int(E.hit.sum()),
           "hit_share": round(float(E.hit.mean()), 4), "hits_per_day": round(float(E.hit.sum() / E.d.nunique()), 2)}
    for y in ["y_win", "y_top2"]:
        res[y] = {"hit": round(float(E[E.hit][y].mean()), 4), "miss": round(float(E[~E.hit][y].mean()), 4),
                  "raw_diff": round(float(E[E.hit][y].mean() - E[~E.hit][y].mean()), 4),
                  "adj_b1_cls_wr": adj(E, "hit", y, ["b1_cls", "band1"]),
                  "adj_b1_cls_wr_and_b2_wr": adj(E, "hit", y, ["b1_cls", "band1", "band2"])}
    res["mean_b1_wr"] = {"hit": round(float(E[E.hit].b1_wr.mean()), 3), "miss": round(float(E[~E.hit].b1_wr.mean()), 3)}
    res["mean_b2_wr"] = {"hit": round(float(E[E.hit].b2_wr.mean()), 3), "miss": round(float(E[~E.hit].b2_wr.mean()), 3)}
    res["mean_nigashi_hit"] = {"rate": round(float(E[E.hit].rate.mean()), 4), "expected": round(float(E[E.hit].exp.mean()), 4), "runs": float(E[E.hit].pn.median())}
    # 単純な二項の検定（当たりの1着が外れと同じだとして）は adj の z で代える
    return res

def build(df_runs, roll, period_from, period_to):
    b1 = df_runs[df_runs.bn == 1][["race_id", "d", "win_rate", "cls", "winner_bn", "second_bn"]].rename(columns={"win_rate": "b1_wr", "cls": "b1_cls"})
    b2 = df_runs[df_runs.bn == 2][["race_id", "d", "racer", "win_rate"]].rename(columns={"win_rate": "b2_wr"})
    R = b1.merge(b2, on=["race_id", "d"]).merge(roll, on=["racer", "d"], how="left")
    R = R[(R.d >= period_from) & (R.d <= period_to) & R.b1_wr.notna() & R.b2_wr.notna()].copy()
    R["pn"] = R.pn.fillna(0)
    R["eligible"] = R.pn >= MIN_RUNS
    R["rate"] = np.where(R.eligible, R.pk / R.pn.clip(lower=1), np.nan)
    R["exp"] = np.where(R.eligible, R.pe / R.pn.clip(lower=1), np.nan)
    R["hit"] = R.eligible & ((R.rate - R.exp) >= TH - 1e-9)
    return R

out = {"ticket": "BOA-1280", "question": "/today の nigashi（2号艇）に当たったレースの1号艇の1着・2連対", "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
       "rule": {"min_runs": MIN_RUNS, "delta_pt": 22, "source": "src/utils/digestMetrics.js・scripts/daily/generate-morning-digest.js・docs/db-migration/098"}}

# ---- M: 本番の再現（グレード込みの期待値） ----
M = df[df.d >= "2025-12-02"].copy()
M["grade"] = M.grade.fillna("ALL_ONLY")  # 2025-12-02 の kb の行はグレード不明 → ALL を使う
c2 = M[M.course == 2]
cell = c2.groupby(["venue", "grade"]).agg(cn=("nige", "size"), cr=("nige", "mean")).reset_index()
allc = c2.groupby("venue").agg(ar=("nige", "mean")).reset_index()
c2 = c2.merge(cell, on=["venue", "grade"], how="left").merge(allc, on="venue", how="left")
c2["bl"] = np.where(c2.cn >= 100, c2.cr, c2.ar)
out["M"] = evaluate(build(M, rolling_course2(c2, "bl", "cum"), "2025-12-03", "2026-11-03"), "本番の再現（2025-12-02 からの累積、会場×グレード×コースの期待値）", "2025-12-03..2026-11-03")

# ---- L: 長期（グレード無し、365日） ----
c2l = df[df.course == 2].copy()
bl = df[(df.course == 2) & (df.d <= "2023-12-31")].groupby("venue").nige.mean().rename("bl").reset_index()
c2l = c2l.merge(bl, on="venue", how="left")
out["L"] = evaluate(build(df, rolling_course2(c2l, "bl", "365"), "2024-01-01", "2026-11-03"), "長期（直近365日、会場×コースの期待値で代用）", "2024-01-01..2026-11-03")
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
