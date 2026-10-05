"""BOA-271 v16 類似レース（タブ2）の層と距離（tasks T2-4。spec FR-B・plan「朝のバッチ」）。

作り方はモックの mock-v16/knn_build.py（knn7＝展示前、knn8＝展示後）と同じ:
- 層（そろえる条件、spec B-1）: 1号艇の級別・1号艇と勝率トップの勝率差の帯（5段階）・勝率トップの艇番。今日が優勝戦・
  準優勝戦ならラウンド、今日が G1・SG なら「G1以上」（グレード不明のレースは入れない）
- 表し方: 艇別の数値×6スロット（母集団で z 化、欠損は0）、レース共通の数値、レース共通カテゴリと艇別カテゴリ（支部）の
  one-hot。艇番は次元にしない
- 重み: 寄与度用の本番モデル（1着）の pred_contrib をレース内で中心化した |SHAP| の平均（特徴量×艇番）。艇別の数値は
  そのスロットの重み、レース共通は6艇分の和、one-hot は w/√2
- 距離: 重み付きユークリッドの2乗に、会場が違うレースは λ＝L/4 を足す。L は cal の先頭500R をクエリ、pool_cal を
  母集団にした k-NN の 401番目の距離²の中央値
- 出走表の時点（racecard）は展示（exh_time・_diff・_rank）と、天候・風・波・最終日を距離から外す（knn7）。展示後
  （exhibition）は最終日だけ外す（knn8）
"""
from __future__ import annotations

import numpy as np
import pandas as pd

RACE_NUM = ["race_number", "wind_x", "wind_y", "wind_speed", "wave_height", "series_day", "is_final_day_num",
            "b1_cls_ord", "b1_nat_win"]
RACE_CAT = ["venue_code", "weather_code", "grade_code", "round_code"]
BOAT_CAT = ["branch_code"]
EXH = ["exh_time", "exh_time_diff", "exh_time_rank"]
EXCLUDED = ["boat_number"]
DROP = {
    "racecard": ["weather_code", "wind_x", "wind_y", "wind_speed", "wave_height", "is_final_day_num"],
    "exhibition": ["is_final_day_num"],
}
LAM_MULT = 0.25
GAP_EDGES = (-1.91, -1.14, -0.49, 0.19)
ROUND_FIX = ("junyu", "yusho")
GRADE_G1_PLUS = ("G1", "SG")


# ---------------------------------------------------------------- 層
def gap_band(nat_win: np.ndarray) -> np.ndarray:
    """(n,6) の全国勝率 → 勝率差の帯 0〜4（差＝round(1号艇 − 2〜6号艇の最大, 2)、境界ちょうどは上の帯）。勝率が無ければ 5"""
    nat = np.asarray(nat_win, dtype=float)
    others = np.where(np.isfinite(nat[:, 1:]), nat[:, 1:], -np.inf).max(1)
    gap = np.round(nat[:, 0] - others, 2)
    b = np.select([gap < GAP_EDGES[0], gap < GAP_EDGES[1], gap < GAP_EDGES[2], gap < GAP_EDGES[3]], [0, 1, 2, 3], 4)
    return np.where(np.isfinite(gap), b, 5)


def top_boat(nat_win: np.ndarray) -> np.ndarray:
    """勝率トップの艇番（同率は艇番の小さいほう）"""
    nat = np.asarray(nat_win, dtype=float)
    return np.where(np.isfinite(nat), nat, -np.inf).argmax(1) + 1


def layer_conditions(b1_class, gap: int, top: int, round_: str | None, grade: str | None) -> dict:
    """今日のレースの層の条件（layer ファイルの conditions と同じ形。plan「BOA-635 との接続」）"""
    return {"b1_class": b1_class, "gap_band": int(gap), "top_boat": int(top),
            "round": round_ if round_ in ROUND_FIX else None, "grade_g1plus": grade in GRADE_G1_PLUS}


def layer_mask(cond: dict, b1_class, gap, top, round_, grade) -> np.ndarray:
    """母集団（配列はレース順）のうち cond とそろうレース"""
    m = (np.asarray(b1_class) == cond["b1_class"]) & (np.asarray(gap) == cond["gap_band"]) \
        & (np.asarray(top) == cond["top_boat"])
    if cond["round"] is not None:
        m &= np.asarray(round_) == cond["round"]
    if cond["grade_g1plus"]:
        m &= np.isin(np.asarray(grade, dtype=object), GRADE_G1_PLUS)
    return m


# ---------------------------------------------------------------- 表し方・重み・距離
def boat_num_features(features: list[str], stage: str) -> list[str]:
    drop = set(RACE_NUM + RACE_CAT + BOAT_CAT + EXCLUDED + DROP[stage]) | (set(EXH) if stage == "racecard" else set())
    return [f for f in features if f not in drop]


def build_z(boats: dict[str, np.ndarray], races: pd.DataFrame, boat_num: list[str], stage: str,
            pool_mask: np.ndarray, norm: dict | None = None, categories: dict | None = None):
    """(n, 列) の z 化・one-hot の行列と、列の説明 meta、標準化の値 norm、one-hot のカテゴリ categories。
    norm・categories を渡すとそれを使う（今日のレースを母集団と同じ列にする）"""
    fit = norm is None
    norm = {} if fit else norm
    categories = {} if categories is None else categories
    blocks, meta = [], []
    for f in boat_num:
        x = np.asarray(boats[f], dtype=np.float32)
        if fit:
            sd = float(np.nanstd(x[pool_mask]))
            norm[f] = {"mean": float(np.nanmean(x[pool_mask])), "sd": sd if sd != 0 else 1.0}
        z = np.nan_to_num((x - norm[f]["mean"]) / norm[f]["sd"]).astype(np.float32)
        for b in range(6):
            blocks.append(z[:, b])
            meta.append({"feature": f, "slot": b + 1, "kind": "boat_num"})
    for f in [f for f in RACE_NUM if f not in DROP[stage]]:
        v = races[f].to_numpy(np.float32)
        if fit:
            norm[f] = {"mean": float(np.nanmean(v[pool_mask])), "sd": float(np.nanstd(v[pool_mask]) or 1.0)}
        blocks.append(np.nan_to_num((v - norm[f]["mean"]) / norm[f]["sd"]).astype(np.float32))
        meta.append({"feature": f, "slot": 0, "kind": "race_num"})
    for f in [f for f in RACE_CAT if f not in DROP[stage]]:
        v = races[f].fillna(-1).to_numpy()
        cats = categories.setdefault(f, [float(c) for c in np.unique(v)])
        for cat in cats:
            blocks.append((v == cat).astype(np.float32))
            meta.append({"feature": f, "slot": 0, "kind": "race_cat", "cat": cat})
    bc = np.nan_to_num(np.asarray(boats["branch_code"], dtype=float), nan=-1)
    cats = categories.setdefault("branch_code", [float(c) for c in np.unique(bc)])
    for b in range(6):
        for cat in cats:
            blocks.append((bc[:, b] == cat).astype(np.float32))
            meta.append({"feature": "branch_code", "slot": b + 1, "kind": "boat_cat", "cat": cat})
    return np.column_stack(blocks).astype(np.float32), meta, norm, categories


def weight_vector(meta: list[dict], weights: dict[str, list[float]]) -> np.ndarray:
    out = np.empty(len(meta), np.float32)
    for i, m in enumerate(meta):
        w = weights[m["feature"]]
        v = w[m["slot"] - 1] if m["slot"] else sum(w)
        out[i] = v / np.sqrt(2) if m["kind"] in ("race_cat", "boat_cat") else v
    return out


def shap_weights(contrib: np.ndarray, feature_names: list[str]) -> dict[str, list[float]]:
    """pred_contrib（行＝艇、レース順・艇番順に6行ずつ、最後の列は bias）から、レース内で中心化した |SHAP| の平均"""
    c = np.asarray(contrib)[:, :-1].reshape(-1, 6, len(feature_names))
    w = np.abs(c - c.mean(axis=1, keepdims=True)).mean(axis=0)
    return {f: [float(x) for x in w[:, j]] for j, f in enumerate(feature_names)}


def lambda_base(X: np.ndarray, pool_cal: np.ndarray, cal: np.ndarray, n_query: int = 500, k: int = 400) -> float:
    Xp = X[pool_cal]
    pn = (Xp ** 2).sum(1)
    q = X[cal[:n_query]]
    vals = []
    for s in range(0, len(q), 50):
        qq = q[s:s + 50]
        D = (qq ** 2).sum(1)[:, None] + pn[None, :] - 2 * qq @ Xp.T
        vals.append(np.partition(D, k, axis=1)[:, k])
    return float(np.median(np.concatenate(vals)))


def rank_layer(X: np.ndarray, xq: np.ndarray, venue: np.ndarray, venue_q: int, lam: float, mask: np.ndarray,
               k: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """mask のレースを距離²（会場が違えば +λ）の近い順に最大 k 件。戻り値は (添字, ペナルティ前の距離², 距離²)"""
    idx = np.where(mask)[0]
    d2 = ((X[idx] - xq) ** 2).sum(1)
    d2p = d2 + np.where(venue[idx] != venue_q, np.float32(lam), np.float32(0))
    order = np.argsort(d2p, kind="stable")[:k]
    return idx[order], d2[order], d2p[order]
