"""BOA-271 MD-6: 層別 vs k-NN の比較・判定・近傍の性質

目的変数: (a) 決まり手6分類（主判定）/ (b) 1着艇番 / (c) 1着の進入コース（結果側の実進入）
方式:
  層別   venue（会場のみ）/ g1only（1号艇級別のみ）/ strat_d（会場→級別→風速→グレード）/
         strat_g（級別→会場→風速→グレード）。いずれも階層 Dirichlet、α は cal で選ぶ
  k-NN   knn（全会場）/ knn_v（同一会場）/ knn_c（同じ会場クラスタ）/ knn_p（会場不一致に距離²+λ、λ は cal）
         分布 = (近傍の件数 + α × 会場の事前分布) / (k + α)。k ∈ {100,200,400,800}・α は cal
比較の相手（事前に固定）: 層別のうち (a) の cal 対数損失が最小のもの（g1only / strat_d / strat_g から）
判定（事前に固定、spec MD-6）: k-NN のいずれかが比較相手に対し (a) の対数損失のペア差 95%CI 上限<0 のときだけ k-NN。
  複数勝つなら (a) の test 対数損失が最小のもの。会場を揃える版（knn_v / knn_c / knn_p）が全会場版に
  有意差なく負けない（ペア差 CI が0をまたぐか、会場版が良い）範囲なら、会場を揃える版を推すと報告に書く。

出力: data/ml/analogy/md6/eval_<tag>.json
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

import md6common as M

sys.path.insert(0, str(M.Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402

TARGETS = {"tech": ("y_tech", 6), "boat": ("y_boat", 6), "course": ("y_course", 6)}
T_INDEX = {"tech": 0, "boat": 1, "course": 2}  # search.py の labels の並び
ALPHAS_KNN = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
ALPHAS_STRAT = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
STRATS = {
    "venue": [["venue_code"]],
    "g1only": [["b1_cls"]],
    "strat_d": [["venue_code"], ["venue_code", "b1_cls"], ["venue_code", "b1_cls", "wind_bin"],
                ["venue_code", "b1_cls", "wind_bin", "grade_bin"]],
    "strat_g": [["b1_cls"], ["b1_cls", "venue_code"], ["b1_cls", "venue_code", "wind_bin"],
                ["b1_cls", "venue_code", "wind_bin", "grade_bin"]],
}
STRAT_CANDIDATES = ["g1only", "strat_d", "strat_g"]
KNN_VARIANTS = ["knn", "knn_v", "knn_c", "knn_p"]
N_BOOT = 1000
EPS = 1e-12


def ll_brier(p, y):
    ll = -np.log(np.clip(p[np.arange(len(y)), y], EPS, 1))
    oh = np.zeros_like(p)
    oh[np.arange(len(y)), y] = 1
    return ll, ((p - oh) ** 2).sum(1)


def venue_prior(pool: pd.DataFrame, ycol, c):
    g = pool[pool[ycol] >= 0].groupby("venue_code")[ycol]
    return {v: (np.bincount(s, minlength=c) + 1) / (len(s) + c) for v, s in g}


def strat_probs(pool, q, levels, ycol, c, alpha):
    pv = pool[pool[ycol] >= 0]
    glob = (np.bincount(pv[ycol], minlength=c) + 1) / (len(pv) + c)
    p = np.tile(glob, (len(q), 1))
    n_last = np.full(len(q), len(pv))
    for keys in levels:
        cnt = pd.crosstab([pv[k] for k in keys], pv[ycol]).reindex(columns=range(c), fill_value=0)
        key_q = pd.MultiIndex.from_frame(q[keys]) if len(keys) > 1 else pd.Index(q[keys[0]])
        cq = cnt.reindex(key_q).fillna(0).to_numpy(np.float64)
        n = cq.sum(1)
        p = (cq + alpha * p) / (n + alpha)[:, None]
        n_last = n
    return p, n_last


def knn_probs(counts, prior, alpha):
    return (counts + alpha * prior) / (counts.sum(1, keepdims=True) + alpha)


def boot(diff, seed=0):
    rng = np.random.default_rng(seed)
    n = len(diff)
    m = np.array([diff[rng.integers(0, n, n)].mean() for _ in range(N_BOOT)])
    return {"mean": float(diff.mean()), "ci95": [float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))],
            "n": int(n)}


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "main_win_F5"
    r, Z, meta = M.load()
    r["y_boat"] = (r["win_boat"] - 1).astype("int8")
    info = json.loads((M.OUT / f"search_{tag}.json").read_text())
    nb = np.load(M.OUT / f"nbr_{tag}.npz")
    per = r["period"].to_numpy()
    sets = {
        "cal": (r[per == "pool_cal"].reset_index(drop=True), r[per == "cal"].reset_index(drop=True)),
        "test": (r[np.isin(per, ["pool_cal", "cal"])].reset_index(drop=True), r[per == "test"].reset_index(drop=True)),
    }
    lams = info["lambdas"]
    res = {"tag": tag, "search": info, "n": {}, "cal": {}, "test": {}, "chosen": {}, "paired": {}}
    preds = {}  # (target, method) -> test probs
    for tname, (ycol, c) in TARGETS.items():
        chosen = {}
        for split in ("cal", "test"):
            pool, q = sets[split]
            y = q[ycol].to_numpy()
            ok = y >= 0
            res["n"][f"{split}_{tname}"] = int(ok.sum())
            prior_map = venue_prior(pool, ycol, c)
            prior = np.vstack([prior_map[v] for v in q["venue_code"]])
            # ---- 層別 ----
            for sname, levels in STRATS.items():
                alphas = ALPHAS_STRAT if split == "cal" else [chosen[sname]["alpha"]]
                best = None
                for a in alphas:
                    p, n_last = strat_probs(pool, q, levels, ycol, c, a)
                    ll, br = ll_brier(p[ok], y[ok])
                    if best is None or ll.mean() < best[0]:
                        best = (ll.mean(), a, p, ll, br, n_last)
                if split == "cal":
                    chosen[sname] = {"alpha": best[1], "cal_logloss": float(best[0]),
                                     "alpha_at_grid_edge": best[1] in (ALPHAS_STRAT[0], ALPHAS_STRAT[-1])}
                else:
                    preds[(tname, sname)] = (best[3], best[4])
                    res["test"].setdefault(tname, {})[sname] = {
                        "logloss": float(best[3].mean()), "brier": float(best[4].mean())}
                    nl = best[5]
                    res.setdefault("strat_n", {}).setdefault(tname, {})[sname] = {
                        "median": float(np.median(nl)), "p10": float(np.percentile(nl, 10)),
                        "p90": float(np.percentile(nl, 90)), "share_lt30": float((nl < 30).mean())}
            # ---- k-NN ----
            for vname in KNN_VARIANTS:
                keys = [f"knn_p{i}" for i in range(len(lams))] if vname == "knn_p" else [vname]
                if split == "test":
                    keys = [chosen[vname]["key"]]
                best = None
                for key in keys:
                    arr = nb[f"{split}_{key}"][:, :, T_INDEX[tname], :].astype(np.float64)
                    cnts = {k: arr[:, j, :] for j, k in enumerate(M.KS)}
                    ks = M.KS if split == "cal" else [chosen[vname]["k"]]
                    alphas = ALPHAS_KNN if split == "cal" else [chosen[vname]["alpha"]]
                    for k in ks:
                        for a in alphas:
                            p = knn_probs(cnts[k], prior, a)
                            ll, br = ll_brier(p[ok], y[ok])
                            if best is None or ll.mean() < best[0]:
                                best = (ll.mean(), key, k, a, ll, br)
                    del cnts
                if split == "cal":
                    chosen[vname] = {"key": best[1], "k": best[2], "alpha": best[3], "cal_logloss": float(best[0])}
                    if vname == "knn_p":
                        li = int(best[1][len("knn_p"):])
                        chosen[vname]["lambda"] = lams[li]
                        chosen[vname]["lambda_over_L"] = info["lambda_mult"][li]
                        chosen[vname]["lambda_at_grid_edge"] = li in (0, len(lams) - 1)
                    chosen[vname]["k_at_grid_edge"] = best[2] in (M.KS[0], M.KS[-1])
                    chosen[vname]["alpha_at_grid_edge"] = best[3] in (ALPHAS_KNN[0], ALPHAS_KNN[-1])
                else:
                    preds[(tname, vname)] = (best[4], best[5])
                    res["test"].setdefault(tname, {})[vname] = {
                        "logloss": float(best[4].mean()), "brier": float(best[5].mean())}
            print(tname, split, "done", flush=True)
        res["chosen"][tname] = chosen
    # ---- 比較相手（事前固定: (a) の cal LL が最小の層別） ----
    ref = min(STRAT_CANDIDATES, key=lambda s: res["chosen"]["tech"][s]["cal_logloss"])
    res["reference_strat"] = ref
    pairs = [(v, ref) for v in KNN_VARIANTS] + [("knn_v", "knn"), ("knn_c", "knn"), ("knn_p", "knn"),
             ("knn_c", "knn_v"), ("knn_p", "knn_v"), ("strat_g", "strat_d"), ("g1only", "strat_d"),
             ("strat_d", "venue")]
    for tname in TARGETS:
        for a, b in pairs:
            la, ba = preds[(tname, a)]
            lb, bb = preds[(tname, b)]
            res["paired"].setdefault(tname, {})[f"{a} - {b}"] = {"logloss": boot(la - lb), "brier": boot(ba - bb)}
    # ---- 判定 ----
    winners = [v for v in KNN_VARIANTS if res["paired"]["tech"][f"{v} - {ref}"]["logloss"]["ci95"][1] < 0]
    dec = {"reference": ref, "knn_winners": winners}
    if winners:
        pick = min(winners, key=lambda v: res["test"]["tech"][v]["logloss"])
        dec["adopt"] = pick
        # 「有意差なく負けない」= 全会場版との差の CI が0をまたぐ、または会場版の方が良い
        dec["venue_aligned_not_worse_than_global"] = {
            v: res["paired"]["tech"][f"{v} - knn"]["logloss"]["ci95"][0] <= 0
            for v in ("knn_v", "knn_c", "knn_p")}
    else:
        dec["adopt"] = ref
    res["decision"] = dec
    (M.OUT / f"eval_{tag}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=float))
    print(json.dumps({"decision": dec, "test": res["test"], "chosen": res["chosen"]}, ensure_ascii=False,
                     indent=1, default=float))


if __name__ == "__main__":
    main()
