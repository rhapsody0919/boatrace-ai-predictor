"""BOA-271 MD-6: k-NN の近傍探索（cal・test）

- cal: クエリ 2025-06-01〜12-02、母集団 2019-04-01〜2025-05-31
- test: クエリ 2026-04-01〜09-30、母集団 2019-04-01〜2025-12-02（データの穴は含めない）
- 方式: 全会場 / 同一会場 / 同じ会場クラスタ / 会場不一致ペナルティ（λ 4通り）
- λ の格子: cal の先頭500R で、全会場 k-NN の400番目の距離²の中央値 L に対し {1/32,1/16,1/8,1/4,1/2,1}×L
- k ∈ {100,200,400,800,1600,3200,6400}。近傍の行番号は保存せず、k ごとのラベル件数（決まり手・1着艇・1着コース）を保存する
- 表示用 n: 類似度 s = 1 − d / d_ref（d_ref = test クエリと母集団の無作為ペアの距離の中央値）で、
  s ≥ 65/75/85/95% の母集団レース数（全会場・同一会場）を数える

使い方: python search.py [weights_file]（既定 weights_main_win_F5.json）
出力: data/ml/analogy/md6/nbr_<weights>.npz, search_<weights>.json
"""
from __future__ import annotations

import json
import sys

import numpy as np

import md6common as M

SIMS = [0.65, 0.75, 0.85, 0.95]


def main():
    wfile = sys.argv[1] if len(sys.argv) > 1 else "weights_main_win_F5.json"
    tag = wfile.replace("weights_", "").replace(".json", "")
    r, Z, meta = M.load()
    wv = M.weight_vector(meta, wfile)
    per = r["period"].to_numpy()
    pool_cal = np.where(per == "pool_cal")[0]
    pool_test = np.where(np.isin(per, ["pool_cal", "cal"]))[0]
    cal = np.where(per == "cal")[0]
    test = np.where(per == "test")[0]
    clu, in_rate = M.venue_clusters(r, per == "pool_cal")
    v = r["venue_code"].to_numpy()
    c = np.array([clu[int(x)] for x in v])

    X = M.weighted(Z, wv)
    rng = np.random.default_rng(0)
    # λ の格子
    Xp = X[pool_cal]
    q = X[cal[:500]]
    Dm = (q ** 2).sum(1)[:, None] + (Xp ** 2).sum(1)[None, :] - 2 * q @ Xp.T
    L = float(np.median(np.partition(Dm, 400, axis=1)[:, 400]))
    LAM_MULT = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1]
    lams = [m * L for m in LAM_MULT]
    # 類似度の基準距離
    qt = X[test[rng.choice(len(test), 500, replace=False)]]
    pr = X[pool_test[rng.choice(len(pool_test), 5000, replace=False)]]
    Dr = np.sqrt(np.maximum((qt ** 2).sum(1)[:, None] + (pr ** 2).sum(1)[None, :] - 2 * qt @ pr.T, 0))
    d_ref = float(np.median(Dr))
    # 母集団全体に対する順位ごとの距離（test 500R）
    Xpt = X[pool_test]
    Dt = np.sqrt(np.maximum((qt ** 2).sum(1)[:, None] + (Xpt ** 2).sum(1)[None, :] - 2 * qt @ Xpt.T, 0))
    ranks = [1, 100, 200, 400, 800, 1600, 3200, 6400]
    Dts = np.partition(Dt, ranks, axis=1)
    dist_at_rank = {str(k): {"median": float(np.median(Dts[:, k - 1])),
                             "sim_median": float(1 - np.median(Dts[:, k - 1]) / d_ref)} for k in ranks}
    del Dt, Dts, Xpt
    thr_d = [(1 - s) * d_ref for s in SIMS]
    del Dm, Dr
    print(f"L={L:.4f} lams={lams} d_ref={d_ref:.4f}", flush=True)

    out = {}
    lab = [r[c].to_numpy().astype(np.int16) for c in ("y_tech", "win_boat", "y_course")]
    lab[1] = lab[1] - 1
    _, _, inex_cal, cc = M.search(X[cal], X[pool_cal], v[cal], v[pool_cal], c[cal], c[pool_cal], lams,
                                  labels=[x[pool_cal] for x in lab], store_idx=False, log="cal")
    for k, a in cc.items():
        out[f"cal_{k}"] = a
    _, cnt, inex_test, ct = M.search(X[test], X[pool_test], v[test], v[pool_test], c[test], c[pool_test], lams,
                                     thr_d=thr_d, labels=[x[pool_test] for x in lab], store_idx=False, log="test")
    for k, a in ct.items():
        out[f"test_{k}"] = a
    for k, a in cnt.items():
        out[f"cnt_{k}"] = a
    np.savez_compressed(M.OUT / f"nbr_{tag}.npz", **out)
    info = {"weights": wfile, "lambda_base_L": L, "lambda_mult": LAM_MULT, "lambdas": lams, "d_ref": d_ref,
            "sims": SIMS, "thr_d": thr_d, "ks": M.KS, "penalty_inexact_queries": [inex_cal, inex_test],
            "venue_clusters": clu, "venue_in_win_rate_pool_cal": in_rate,
            "n_pool_cal": int(len(pool_cal)), "n_pool_test": int(len(pool_test)),
            "n_cal": int(len(cal)), "n_test": int(len(test)), "test_dist_at_rank": dist_at_rank}
    (M.OUT / f"search_{tag}.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
