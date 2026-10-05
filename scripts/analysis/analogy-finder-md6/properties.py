"""BOA-271 MD-6: 近傍の性質（何が今日のレースと似ているか）・表示用 n・重み再学習での入れ替わり

- 標本: test から無作為 2,000R。k は各方式で (a) の cal で選んだ値
- テーマ別の差: 重みを掛けない z 値で、近傍と当該レースの平均絶対差 ÷ 無作為の母集団レース（各400R）との差。
  1 に近いほど揃っていない。艇別の項目は6艇分の平均
- 一致率: 会場・1号艇級別・グレード区分・風速ビン・ラウンド・天候
- 表示用 n: 類似度 s = 1 − d / d_ref ごとの母集団件数（search.py が数えた test 全件）
- 入れ替わり: seed を変え木の数を固定（313本）して学習し直した重みで、同じ標本の近傍を引き直し Jaccard

使い方: python properties.py [tag]（既定 main_win_F5）
出力: data/ml/analogy/md6/props_<tag>.json
"""
from __future__ import annotations

import json
import sys

import numpy as np

import md6common as M

sys.path.insert(0, str(M.Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402

N_SAMPLE = 2000
N_RAND = 400
SEED_WEIGHTS = ["weights_main_win_F5_fix_seed1.json", "weights_main_win_F5_fix_seed2.json"]
MATCH_KEYS = ["venue_code", "b1_cls", "grade_bin", "wind_bin", "round_code", "weather_code"]


def theme_of(f):
    for t, fs in C.THEMES.items():
        if f in fs:
            return t
    return None


def diffs(Z, q_rows, nbr_rows, num_cols):
    """クエリごとに近傍との平均絶対差（列ごと）を取り、クエリで平均。"""
    acc = np.zeros(len(num_cols))
    for qi, nr in zip(q_rows, nbr_rows):
        acc += np.abs(Z[nr][:, num_cols] - Z[qi, num_cols]).mean(0)
    return acc / len(q_rows)


def lambda_base(X, pool_cal, cal):
    Xp, q = X[pool_cal], X[cal[:500]]
    Dm = (q ** 2).sum(1)[:, None] + (Xp ** 2).sum(1)[None, :] - 2 * q @ Xp.T
    return float(np.median(np.partition(Dm, 400, axis=1)[:, 400]))


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "main_win_F5"
    r, Zm, meta = M.load()
    Z = np.asarray(Zm)
    ev = json.loads((M.OUT / f"eval_{tag}.json").read_text())
    info = ev["search"]
    nb = np.load(M.OUT / f"nbr_{tag}.npz")  # 表示用 n の件数（cnt_*）だけ使う
    per = r["period"].to_numpy()
    pool_cal = np.where(per == "pool_cal")[0]
    pool = np.where(np.isin(per, ["pool_cal", "cal"]))[0]
    cal = np.where(per == "cal")[0]
    test = np.where(per == "test")[0]
    rng = np.random.default_rng(1)
    sub = np.sort(rng.choice(len(test), N_SAMPLE, replace=False))
    q_rows = test[sub]
    rand_rows = pool[rng.integers(0, len(pool), (N_SAMPLE, N_RAND))]
    chosen = ev["chosen"]["tech"]
    v_all = r["venue_code"].to_numpy()
    clu = {int(a): b for a, b in info["venue_clusters"].items()}
    c_all = np.array([clu[int(x)] for x in v_all])
    lam_mult = chosen["knn_p"]["lambda_over_L"]

    def sample_neighbors(wfile, lam):
        X = M.weighted(Z, M.weight_vector(meta, wfile))
        if lam is None:
            lam = lam_mult * lambda_base(X, pool_cal, cal)
        idx, _, _, _ = M.search(X[q_rows], X[pool], v_all[q_rows], v_all[pool], c_all[q_rows], c_all[pool],
                                [lam], store_idx=True, log=wfile)
        idx["knn_p"] = idx.pop("knn_p0")
        return idx

    main_idx = sample_neighbors(info["weights"], chosen["knn_p"]["lambda"])

    num_cols = [i for i, m in enumerate(meta) if m["kind"] in ("boat_num", "race_num")]
    feat_of = [meta[i]["feature"] for i in num_cols]
    slot_of = [meta[i]["slot"] for i in num_cols]

    def summarize(dn, dr):
        ratio = dn / dr
        by_feat = {}
        for f in dict.fromkeys(feat_of):
            j = [k for k, x in enumerate(feat_of) if x == f]
            by_feat[f] = {"theme": theme_of(f), "nbr": float(dn[j].mean()), "rand": float(dr[j].mean()),
                          "ratio": float(dn[j].mean() / dr[j].mean())}
        for f in ("nat_win", "cls_ord", "exh_time", "motor_2"):
            for slot_name, slots in (("1号艇", [1]), ("2〜6号艇", [2, 3, 4, 5, 6])):
                j = [k for k, (x, s) in enumerate(zip(feat_of, slot_of)) if x == f and s in slots]
                by_feat[f"{f}@{slot_name}"] = {"theme": theme_of(f), "nbr": float(dn[j].mean()),
                                               "rand": float(dr[j].mean()),
                                               "ratio": float(dn[j].mean() / dr[j].mean())}
        by_theme = {}
        for t in C.THEMES:
            j = [k for k, x in enumerate(feat_of) if theme_of(x) == t]
            if j:
                by_theme[t] = {"nbr": float(dn[j].mean()), "rand": float(dr[j].mean()),
                               "ratio": float(dn[j].mean() / dr[j].mean()), "n_cols": len(j)}
        return {"by_theme": by_theme, "by_feature": by_feat, "_ratio_cols": ratio}

    def match(nbr_rows):
        out = {}
        for k in MATCH_KEYS:
            a = r[k].fillna(-1).to_numpy()
            out[k] = float((a[nbr_rows] == a[q_rows][:, None]).mean())
        a, b = r["venue_code"].to_numpy(), r["b1_cls"].to_numpy()
        out["venue_and_b1_cls"] = float(((a[nbr_rows] == a[q_rows][:, None]) &
                                         (b[nbr_rows] == b[q_rows][:, None])).mean())
        return out

    dr = diffs(Z, q_rows, rand_rows, num_cols)
    props = {"n_sample": N_SAMPLE, "n_random_per_query": N_RAND, "random": {"match": match(rand_rows)},
             "variants": {}}
    for v in ("knn", "knn_v", "knn_c", "knn_p"):
        key = chosen[v]["key"]
        props["variants"][v] = {}
        for label, k in (("chosen_k", chosen[v]["k"]), ("k100", 100)):
            nbr_rows = pool[main_idx[v][:, :k]]
            dn = diffs(Z, q_rows, nbr_rows, num_cols)
            s = summarize(dn, dr)
            s.pop("_ratio_cols")
            props["variants"][v][label] = {"key": key, "k": k, **s, "match": match(nbr_rows)}
            print(v, k, {t: round(x["ratio"], 3) for t, x in s["by_theme"].items()},
                  props["variants"][v][label]["match"], flush=True)

    # ---- 表示用 n ----
    disp = {}
    for v in ("knn", "knn_v"):
        cnt = nb[f"cnt_{v}"]
        k = chosen[v]["k"]
        disp[v] = {}
        for j, s in enumerate(info["sims"]):
            cfull = cnt[:, j]
            ck = np.minimum(cfull, k)
            disp[v][f"{int(s*100)}%"] = {
                "pool_count": {"median": float(np.median(cfull)), "p10": float(np.percentile(cfull, 10)),
                               "p90": float(np.percentile(cfull, 90)), "share_zero": float((cfull == 0).mean())},
                "within_k": {"k": k, "median": float(np.median(ck)), "p10": float(np.percentile(ck, 10)),
                             "p90": float(np.percentile(ck, 90)), "share_lt30": float((ck < 30).mean())}}
    props["display_n"] = disp

    # ---- 重みの再学習での入れ替わり ----
    seed_idx = {wf: sample_neighbors(wf, None) for wf in SEED_WEIGHTS}
    jac = {}
    for v in ("knn", "knn_v", "knn_c", "knn_p"):
        key, k = chosen[v]["key"], chosen[v]["k"]
        base = main_idx[v][:, :k]
        sets = {"main": base, **{wf: seed_idx[wf][v][:, :k] for wf in SEED_WEIGHTS}}
        jac[v] = {"k": k}
        names = list(sets)
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                a, b = sets[names[i]], sets[names[j]]
                js = np.array([len(np.intersect1d(x, y, assume_unique=True)) /
                               len(np.union1d(x, y)) for x, y in zip(a, b)])
                jac[v][f"{names[i]} vs {names[j]}"] = {
                    "mean": float(js.mean()), "median": float(np.median(js)), "p10": float(np.percentile(js, 10))}
        print(v, jac[v], flush=True)
    props["jaccard"] = jac
    (M.OUT / f"props_{tag}.json").write_text(json.dumps(props, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
