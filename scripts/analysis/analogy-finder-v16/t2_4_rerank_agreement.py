"""BOA-271 v16 tasks T2-4: 展示後の並べ直しの近似の一致率。

本番の展示後の段（src/utils/analogySimilarRerank.js）は、朝のバッチが出走表の距離で選んだ候補（層の中の近い順に
最大 MAX_CANDIDATES 件）だけを、展示後の距離で並べ直す。層が候補より大きいと、候補の外に展示後の上位が落ちうる。
過去のレースで、次の2つの上位800件の重なりを数える（目標 99%以上。plan「展示後の段」）:
  厳密: 層の全件を展示後の表し方（knn8）の距離²＋λ_展示×会場違い で並べた上位800件
  近似: 層の中で出走表の距離²（knn7）＋λ×会場違い の上位 K 件を候補にし、その中を同じ展示後の距離で並べた上位800件
  （K は環境変数 T24_CANDIDATES、既定は本番の v16_morning.MAX_CANDIDATES）
一致率＝|厳密 ∩ 近似| ÷ min(800, 層の件数)。層の大きさ別にまとめる。

対象: 母集団（v16_morning と同じ: 完全レース、2019-04-01〜）のうち、本体の期間（2025-12-03〜）で6艇の展示タイムが
そろうレースから無作為に1,000件（seed 0）。各レースの層は、そのレース自身を除く母集団の全件（時点をずらさない。
近似の質だけを見るため）。距離の重み・標準化・L は v16_morning.build_distance と同じ（表示中の版の model_win）。

使い方（scripts/ml/analogy をカレントに）:
  ANALOGY_DATA_DIR=... python ../../analysis/analogy-finder-v16/t2_4_rerank_agreement.py <model_win.txt> <出力の json>
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml" / "analogy"))
import features as F  # noqa: E402
import v16_morning as M  # noqa: E402
import v16_similar as S  # noqa: E402

import os

N_QUERIES, SEED, TOP = 1000, 0, M.MAX_SHOWN
K = int(os.environ.get("T24_CANDIDATES", M.MAX_CANDIDATES))  # 候補の数を変えて測る（既定は本番と同じ）
BUCKETS = [(0, 800), (801, 10_000), (10_001, 20_000), (20_001, 40_000), (40_001, 10**9)]


def main(model_path: str, out_path: str):
    t0 = time.time()
    df = F.build(F.D)
    keep = df["race_ok"] & (df["race_date"] >= M.POOL_FROM)
    cols = [c for c in df.columns if c not in ("race_id", "race_date", "branch", "cls", "grade", "round", "race_ok")
            and (pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_bool_dtype(df[c]))]
    races, arrays = M.race_arrays(df[keep], cols)
    arrays["cls_name"] = M.class_names(arrays["cls_ord"])
    pool = np.ones(len(races), bool)
    weights, feats = M.load_weights(Path(model_path), df[df["race_id"].isin(races["race_id"])], races)
    X, info = M.build_distance(arrays, races, feats, weights, "racecard", pool)
    Xe, info_e = M.build_distance(arrays, races, feats, weights, "exhibition", pool)
    print(f"distance {time.time() - t0:.0f}s L={info['L']:.4f} L_exh={info_e['L']:.4f}", flush=True)

    b1 = arrays["cls_name"][:, 0]
    gap, top = S.gap_band(arrays["nat_win"]), S.top_boat(arrays["nat_win"])
    rnd = races["round"].to_numpy(dtype=object)
    grade = races["grade"].to_numpy(dtype=object)
    venue = races["venue_code"].astype(int).to_numpy()
    exh_ok = ~np.isnan(arrays["exh_time"]).any(axis=1) & (races["race_date"] > F.KB_END).to_numpy()
    qs = np.random.default_rng(SEED).choice(np.flatnonzero(exh_ok), N_QUERIES, replace=False)

    rows = []
    for n, i in enumerate(qs):
        cond = S.layer_conditions(b1[i], gap[i], top[i], rnd[i], grade[i])
        lm = S.layer_mask(cond, b1, gap, top, rnd, grade) & pool
        lm[i] = False
        n_layer = int(lm.sum())
        if n_layer == 0:
            continue
        exact, _, _ = S.rank_layer(Xe, Xe[i], venue, int(venue[i]), info_e["lambda"], lm, TOP)
        cand, _, _ = S.rank_layer(X, X[i], venue, int(venue[i]), info["lambda"], lm, K)
        cm = np.zeros(len(races), bool)
        cm[cand] = True
        approx, _, _ = S.rank_layer(Xe, Xe[i], venue, int(venue[i]), info_e["lambda"], cm, TOP)
        k = min(TOP, n_layer)
        rows.append({"race_id": F.int_to_rid(int(races["race_id"].iat[i])), "n_layer": n_layer,
                     "agree": len(set(exact.tolist()) & set(approx.tolist())) / k})
        if n % 100 == 0:
            print(f"{n} {time.time() - t0:.0f}s", flush=True)

    r = pd.DataFrame(rows)
    by = []
    for lo, hi in BUCKETS:
        sub = r[(r["n_layer"] >= lo) & (r["n_layer"] <= hi)]
        if len(sub):
            by.append({"layer": f"{lo}〜{hi if hi < 10**9 else ''}", "n": int(len(sub)),
                       "mean": round(float(sub["agree"].mean()), 5), "min": round(float(sub["agree"].min()), 5),
                       "p05": round(float(sub["agree"].quantile(0.05)), 5),
                       "share_ge_99": round(float((sub["agree"] >= 0.99).mean()), 4)})
    data = {"rows": int(len(df)), "races": int(len(races)), "max_race_date": str(races["race_date"].max())[:10],
            "data_dir": "ANALOGY_DATA_DIR（export_pool.js の出力。本体は 2026-10-05、長期は 10/04 のアーカイブ＋新しい列）"}
    out = {"source": __doc__.split("\n")[0], "data": data, "queries": int(len(r)), "seed": SEED, "candidates": K,
           "top": TOP,
           "model": str(model_path), "L": info["L"], "L_exhibition": info_e["L"],
           "overall": {"mean": round(float(r["agree"].mean()), 5), "min": round(float(r["agree"].min()), 5),
                       "share_ge_99": round(float((r["agree"] >= 0.99).mean()), 4)},
           "by_layer": by, "worst": r.nsmallest(10, "agree").to_dict("records")}
    Path(out_path).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps(out["overall"], ensure_ascii=False), json.dumps(by, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
