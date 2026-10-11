"""BOA-271 k-NN（MD-6 の knn_p）で例のレース 2026-09-27-20-12 の近傍を出す 1/3: 行列・重み・探索

MD-6（scripts/analysis/analogy-finder-md6/prep.py・weights.py・md6common.py・search.py）と同じ作り方:
  - レースの表し方: 艇別の数値（BASE_FEATURES から レース共通・カテゴリ・艇番 を除いたもの）×6スロット、
    レース共通の数値9（race_number・wind_x・wind_y・wind_speed・wave_height・series_day・is_final_day_num・
    b1_cls_ord・b1_nat_win）、レース共通カテゴリ4（venue_code・weather_code・grade_code・round_code）の one-hot、
    艇別カテゴリ（branch_code）のスロット別 one-hot。boat_number は次元にしない
  - 標準化: 数値は母集団で z 化し、欠損は 0（＝母集団の平均）。カテゴリの欠損は「-1」という1つのカテゴリの one-hot
  - 重み: 1着モデルの pred_contrib をレース内で中心化した |SHAP| の平均（特徴量×艇番）。艇別の数値はそのスロットの重み、
    レース共通は6艇分の和、one-hot は w/√2。標本は 2025-01-01〜2025-12-02 の無作為 5,000R（seed 7）
  - 距離: 重み付きユークリッド。knn_p＝会場が違うレースの距離²に λ を足す。λ = L × 1/4（MD-6 で (a) 決まり手に選ばれた倍率）。
    L＝cal（2025-06-01〜2025-12-02）の先頭500R をクエリ、pool_cal（2019-04-01〜2025-05-31）を母集団にした
    全会場 k-NN の 401番目（np.partition(..., 400)）の距離²の中央値。重みを変えたので L は引き直す
  - MD-6 の search はペナルティ版を候補集合から選ぶ近似だが、ここは1クエリなので全件の厳密な順位

MD-6 からの変更（依頼による）:
  - 重みのモデル: 寄与度用の本番モデル（版 2026-10-02 の model_win）
  - 出走表の時点の情報だけ: 展示タイム（exh_time・exh_time_diff・exh_time_rank）を距離から外す
    （当該レースの ST は MD-6 でも特徴量に無い）。参考に、展示を含めた版（variant "with_exh"）も同じ手順で作る
  - 母集団: 2019-04-01〜2026-09-26 の完全レース（データの穴の月も含める。MD-6 は 2025-12-03〜2026-03-31 を除外していた）
  - 特徴量: 学習時のコード（dc6d02084）の features.py。データは model-prep/data（長期は Storage のキャッシュ、本体は DB）

環境変数: KNN_TAG（knn＝1版目・work/、knn2＝work2/）、KNN_DROP（距離から外すレース共通の列、カンマ区切り）
  knn2: KNN_TAG=knn2 KNN_DROP=weather_code,wind_x,wind_y,wind_speed,wave_height,is_final_day_num
出力: work/races.pkl・work/boats.npz（艇別の値）・work/search.json・work/nbr_<variant>.npz
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
MP = HERE.parent / "model-prep"
sys.path.insert(0, str(MP / "code-at-train"))
import features as F  # noqa: E402
from themes import FEATURES, THEMES  # noqa: E402

VERSION = "2026-10-02"
QUERY = "2026-09-27-20-12"
POOL = ("2019-04-01", "2026-09-26")
POOL_CAL = ("2019-04-01", "2025-05-31")
CAL = ("2025-06-01", "2025-12-02")
SHAP_SAMPLE = ("2025-01-01", "2025-12-02")
SHAP_RACES = 5000
LAM_MULT = 0.25
KTOP = 800
EXH = ["exh_time", "exh_time_diff", "exh_time_rank"]
RACE_NUM = ["race_number", "wind_x", "wind_y", "wind_speed", "wave_height", "series_day",
            "is_final_day_num", "b1_cls_ord", "b1_nat_win"]
RACE_CAT = ["venue_code", "weather_code", "grade_code", "round_code"]
BOAT_CAT = ["branch_code"]
EXCLUDED = ["boat_number"]
GROUP_OF = {f: g["key"] for t in THEMES for g in t["groups"] for f in g["features"]}
THEME_OF = {f: t["key"] for t in THEMES for g in t["groups"] for f in g["features"]}
# 値として残す艇別の列（距離に入らない st_result・finish_rank も結果の表示用に残す）
# 版の切り替え（knn: 1版目、knn2: 天候・風・波・最終日も距離から外す）。出力は work/ か work2/
TAG = os.environ.get("KNN_TAG", "knn")
WORK = HERE / ("work" if TAG == "knn" else f"work{TAG[3:]}")
DROP = [c for c in os.environ.get("KNN_DROP", "").split(",") if c]
RACE_NUM_ALL, RACE_CAT_ALL = list(RACE_NUM), list(RACE_CAT)
RACE_NUM_USE = [f for f in RACE_NUM if f not in DROP]
RACE_CAT_USE = [f for f in RACE_CAT if f not in DROP]
BOAT_KEEP = FEATURES + ["st_result", "finish_rank", "racer_id", "is_flying", "is_late"]


def period(s, a, b):
    return (s >= pd.Timestamp(a)) & (s <= pd.Timestamp(b))


def build_tables():
    t0 = time.time()
    df = F.build(F.D)
    qid = int(QUERY.replace("-", ""))
    keep = df["race_ok"] & (period(df["race_date"], *POOL) | (df["race_id"] == qid))
    df = df[keep].sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    assert (df.groupby("race_id").size() == 6).all()
    assert (df["boat_number"].to_numpy().reshape(-1, 6) == np.arange(1, 7)).all()
    n = len(df) // 6
    first = df[df["boat_number"] == 1].reset_index(drop=True)
    r = first[list(dict.fromkeys(["race_id", "race_date", "venue_code", "race_number", "grade", "round"] + RACE_NUM
              + RACE_CAT))].copy()
    fr = df["finish_rank"].to_numpy().reshape(n, 6)
    for k in (1, 2, 3):
        hit = fr == k
        r[f"rank{k}"] = np.where(hit.any(1), hit.argmax(1) + 1, 0).astype("int8")
    r["is_query"] = r["race_id"] == qid
    r["is_pool"] = ~r["is_query"]
    boats = {c: df[c].to_numpy().astype("float64" if c != "racer_id" else "float64").reshape(n, 6)
             for c in BOAT_KEEP if c not in ("is_flying", "is_late")}
    boats["is_flying"] = df["is_flying"].to_numpy().astype(bool).reshape(n, 6)
    boats["is_late"] = df["is_late"].to_numpy().astype(bool).reshape(n, 6)
    print(f"tables: {n:,} races (pool {int(r['is_pool'].sum()):,}) ({time.time() - t0:.0f}s)", flush=True)
    return df, r, boats


def build_Z(df, r, boat_num, pool_mask):
    n = len(r)
    blocks, meta = [], []
    X = df[boat_num].to_numpy(np.float32).reshape(n, 6, len(boat_num))
    mu = np.nanmean(X[pool_mask], axis=(0, 1))
    sd = np.nanstd(X[pool_mask], axis=(0, 1))
    sd[sd == 0] = 1
    Zb = np.nan_to_num((X - mu) / sd).astype(np.float32)
    norm = {}
    for j, f in enumerate(boat_num):
        norm[f] = {"mean": float(mu[j]), "sd": float(sd[j])}
        for b in range(6):
            blocks.append(Zb[:, b, j][:, None])
            meta.append({"feature": f, "slot": b + 1, "kind": "boat_num"})
    for f in RACE_NUM_USE:
        v = r[f].to_numpy(np.float32)
        m, s = float(np.nanmean(v[pool_mask])), float(np.nanstd(v[pool_mask]) or 1.0)
        norm[f] = {"mean": m, "sd": s}
        blocks.append(np.nan_to_num((v - m) / s)[:, None].astype(np.float32))
        meta.append({"feature": f, "slot": 0, "kind": "race_num"})
    for f in RACE_CAT_USE:
        v = r[f].fillna(-1).to_numpy()
        for cat in np.unique(v):
            blocks.append((v == cat).astype(np.float32)[:, None])
            meta.append({"feature": f, "slot": 0, "kind": "race_cat", "cat": float(cat)})
    bc = df["branch_code"].fillna(-1).to_numpy().reshape(n, 6)
    for b in range(6):
        for cat in np.unique(bc):
            blocks.append((bc[:, b] == cat).astype(np.float32)[:, None])
            meta.append({"feature": "branch_code", "slot": b + 1, "kind": "boat_cat", "cat": float(cat)})
    return np.hstack(blocks).astype(np.float32), meta, norm


def shap_weights(df, r):
    m = lgb.Booster(model_file=str(MP / "models" / VERSION / "model_win.txt"))
    feats = m.feature_name()
    rng = np.random.default_rng(7)
    cand = r.loc[period(r["race_date"], *SHAP_SAMPLE) & r["is_pool"], "race_id"].to_numpy()
    ids = rng.choice(cand, SHAP_RACES, replace=False)
    rows = df[df["race_id"].isin(ids)].sort_values(["race_id", "boat_number"])
    contrib = m.predict(rows[feats].astype("float32"), pred_contrib=True)[:, :-1]
    c = contrib.reshape(-1, 6, len(feats))
    c = c - c.mean(axis=1, keepdims=True)
    w = np.abs(c).mean(axis=0)
    return {"model": f"{VERSION}/model_win.txt", "num_trees": m.num_trees(), "n_races": int(c.shape[0]),
            "sample_period": SHAP_SAMPLE, "seed": 7,
            "weights": {f: [float(x) for x in w[:, j]] for j, f in enumerate(feats)}}


def weight_vector(meta, w):
    out = np.empty(len(meta), np.float32)
    for i, m in enumerate(meta):
        f = m["feature"]
        v = w[f][m["slot"] - 1] if m["slot"] else sum(w[f])
        if m["kind"] in ("race_cat", "boat_cat"):
            v /= np.sqrt(2)
        out[i] = v
    return out


def lambda_base(X, pool_cal, cal):
    Xp = X[pool_cal]
    pn = (Xp ** 2).sum(1)
    q = X[cal[:500]]
    vals = []
    for s in range(0, len(q), 50):
        qq = q[s:s + 50]
        D = (qq ** 2).sum(1)[:, None] + pn[None, :] - 2 * qq @ Xp.T
        vals.append(np.partition(D, 400, axis=1)[:, 400])
    return float(np.median(np.concatenate(vals)))


# knn3: 例のレースと「勝率差5帯（120 の analogy_gap_band）・1号艇の級別・勝率1位の艇（同率は若い艇番）」が
# すべて同じ母集団レースだけを並べる（KNN_LAYER=1）。z 化・重み・L・λ は層で絞る前の母集団で作る（knn2 と同じ距離）
LAYER = os.environ.get("KNN_LAYER") == "1"


def gap_band_arr(nat):
    """120 の analogy_gap_band: gap = round(1号艇の勝率 − 2〜6号艇の勝率の最大, 2)。境界ちょうどは上の帯。勝率が無ければ 5"""
    others = np.where(np.isfinite(nat[:, 1:]), nat[:, 1:], -np.inf).max(1)
    gap = np.round(nat[:, 0].astype(np.float64) - others.astype(np.float64), 2)
    ok = np.isfinite(gap)
    b = np.select([gap < -1.91, gap < -1.14, gap < -0.49, gap < 0.19], [0, 1, 2, 3], 4)
    return np.where(ok, b, 5)


# knn5/knn6: KNN_ROUND=1 なら、今日が優勝戦・準優勝戦のときだけ「ラウンドが今日と同じ」を層の条件に足す
# （予選・その他の日は足さない）。round_code: 0=予選・1=準優・2=優勝戦・3=その他（features.ROUNDS）
ROUND_COND = os.environ.get("KNN_ROUND") == "1"
ROUND_FIX = (F.ROUND_CODE["junyu"], F.ROUND_CODE["yusho"])
# knn7/knn8: KNN_GRADE=1 なら、今日のグレードが G1・SG のときだけ「グレードが G1 以上」を層の条件に足す
# （それ以外のグレードの日は足さない）。grade_code: 0=一般・1=G3・2=G2・3=G1・4=SG（features.GRADES）
GRADE_COND = os.environ.get("KNN_GRADE") == "1"
GRADE_MIN = F.GRADE_CODE["G1"]


def layer_mask(boats, qi, r=None):
    nat = boats["nat_win"]
    gb = gap_band_arr(nat)
    c1 = np.nan_to_num(boats["cls_ord"][:, 0], nan=0)
    natf = np.where(np.isfinite(nat), nat, -np.inf)
    top = natf.argmax(1) + 1
    m = (gb == gb[qi]) & (c1 == c1[qi]) & (top == top[qi])
    key = {"gap_band": int(gb[qi]), "b1_cls_ord": float(c1[qi]), "top_boat": int(top[qi])}
    if ROUND_COND:
        rc = r["round_code"].to_numpy()
        qrc = rc[qi]
        if np.isfinite(qrc) and int(qrc) in ROUND_FIX:
            m = m & (rc == qrc)
            key["round_code"] = int(qrc)
            key["round"] = F.ROUNDS[int(qrc)]
        else:
            key["round"] = None  # 今日が優勝戦・準優勝戦でないので足していない
    if GRADE_COND:
        gc = r["grade_code"].to_numpy()
        qgc = gc[qi]
        if np.isfinite(qgc) and int(qgc) >= GRADE_MIN:
            m = m & np.isfinite(gc) & (gc >= GRADE_MIN)
            key["grade_min_code"] = GRADE_MIN
            key["grade_min"] = "G1"
        else:
            key["grade_min"] = None  # 今日が G1・SG でないので足していない
    return m, key


def main():
    t0 = time.time()
    WORK.mkdir(exist_ok=True)
    df, r, boats = build_tables()
    pool_mask = r["is_pool"].to_numpy()
    qi = int(np.where(r["is_query"])[0][0])
    wres = shap_weights(df, r)
    (WORK / "weights.json").write_text(json.dumps(wres, ensure_ascii=False, indent=1))
    w = wres["weights"]
    v = r["venue_code"].astype(int).to_numpy()
    rd = r["race_date"]
    pool_cal = np.where(period(rd, *POOL_CAL) & pool_mask)[0]
    cal = np.where(period(rd, *CAL) & pool_mask)[0]
    rng = np.random.default_rng(0)
    rand_q = rng.choice(np.where(pool_mask)[0], 500, replace=False)
    rand_p = rng.choice(np.where(pool_mask)[0], 5000, replace=False)
    info = {"model_version": VERSION, "query": QUERY, "pool_period": POOL, "n_pool": int(pool_mask.sum()),
            "n_pool_by_source": {"kb_le_2025-12-02": int((pool_mask & (rd <= F.KB_END)).sum()),
                                 "main_ge_2025-12-03": int((pool_mask & (rd > F.KB_END)).sum())},
            "lambda_mult": LAM_MULT, "pool_cal": POOL_CAL, "cal": CAL, "n_pool_cal": int(len(pool_cal)),
            "n_cal": int(len(cal)), "variants": {}}
    lmask, lkey = layer_mask(boats, qi, r)
    if LAYER:
        info["layer"] = {"key": lkey, "n": int((pool_mask & lmask).sum()),
                         "n_kb": int((pool_mask & lmask & (rd <= F.KB_END)).sum()),
                         "n_main": int((pool_mask & lmask & (rd > F.KB_END)).sum())}
        np.save(WORK / "layer_mask.npy", pool_mask & lmask)
        print("layer", info["layer"], flush=True)
    r.to_pickle(WORK / "races.pkl")
    np.savez_compressed(WORK / "boats.npz", **boats)
    for variant in ("racecard", "with_exh"):
        boat_num = [f for f in FEATURES if f not in RACE_NUM + RACE_CAT + BOAT_CAT + EXCLUDED
                    and (variant == "with_exh" or f not in EXH)]
        Z, meta, norm = build_Z(df, r, boat_num, pool_mask)
        wv = weight_vector(meta, w)
        X = (Z * wv).astype(np.float32)
        del Z
        L = lambda_base(X, pool_cal, cal)
        lam = L * LAM_MULT
        xq = X[qi]
        diff2 = (X - xq) ** 2
        d2 = diff2.sum(1)
        mis = v != v[qi]
        d2p = d2 + np.where(mis, np.float32(lam), np.float32(0))
        rank_mask = pool_mask & lmask if LAYER else pool_mask
        d2p_pool = np.where(rank_mask, d2p, np.inf)
        order = np.argsort(d2p_pool, kind="stable")
        npool = int(pool_mask.sum())
        ktop = min(KTOP, int(rank_mask.sum()))
        top = order[:ktop]
        # 列 → グループ（themes.py のグループ）
        col_group = np.array([GROUP_OF[m["feature"]] for m in meta])
        groups = list(dict.fromkeys(col_group))
        gsum = np.column_stack([diff2[top][:, col_group == g].sum(1) for g in groups])
        # 無作為ペアの距離（MD-6 の d_ref と同じ作り方: 500×5000 の中央値）
        Dr = ((X[rand_q] ** 2).sum(1)[:, None] + (X[rand_p] ** 2).sum(1)[None, :]
              - 2 * X[rand_q] @ X[rand_p].T)
        Dr = np.maximum(Dr, 0)
        lam_mis = (v[rand_q][:, None] != v[rand_p][None, :]) * lam
        # 今日のレースと全母集団の距離（参考）
        d_pool = np.sqrt(d2[pool_mask])
        dp_pool = np.sqrt(d2p[pool_mask])
        ranks = [1, 20, 100, 200, 400, 800]
        np.savez_compressed(WORK / f"nbr_{variant}.npz", top=top, d2=d2[top], d2p=d2p[top],
                            group_d2=gsum, groups=np.array(groups), order_full=order[:5000])
        info["variants"][variant] = {
            "boat_num_features": boat_num, "race_num_features": RACE_NUM_USE, "race_cat_features": RACE_CAT_USE,
            "boat_cat_features": BOAT_CAT, "excluded": EXCLUDED + ([] if variant == "with_exh" else EXH) + DROP,
            "n_columns": int(X.shape[1]), "groups_in_distance": groups, "L": L, "lambda": lam,
            "normalization": norm,
            "dist_at_rank_penalized": {str(k): float(np.sqrt(d2p[order[k - 1]])) for k in ranks if k <= ktop},
            "dist_at_rank_unpenalized_of_same_race": {str(k): float(np.sqrt(d2[order[k - 1]])) for k in ranks if k <= ktop},
            "dist_rank_unpenalized_sorted": {str(k): float(np.sort(d_pool)[k - 1]) for k in ranks},
            "random_pair_median": float(np.median(np.sqrt(Dr))),
            "random_pair_median_penalized": float(np.median(np.sqrt(Dr + lam_mis))),
            "query_to_pool_median": float(np.median(d_pool)),
            "query_to_pool_median_penalized": float(np.median(dp_pool)),
            "n_pool": npool,
            "top_venue_match_rate": {str(k): float((v[order[:k]] == v[qi]).mean()) for k in (20, 50, 100, 200, 400, 800) if k <= ktop},
            "n_ranked": ktop,
        }
        tot = float((wv ** 2).sum())
        info["variants"][variant]["weight_sq_share_by_group"] = {
            g: float((wv[col_group == g] ** 2).sum() / tot) for g in groups}
        print(variant, f"cols {X.shape[1]} L {L:.4f} lam {lam:.4f} d1 {np.sqrt(d2p[order[0]]):.4f} "
              f"d{ktop} {np.sqrt(d2p[order[ktop - 1]]):.4f} ({time.time() - t0:.0f}s)", flush=True)
        del X, diff2
    (WORK / "search.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
