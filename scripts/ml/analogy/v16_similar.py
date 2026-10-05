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


def compare_conditions(cond: dict) -> tuple[dict, str]:
    """比べる相手（spec B-8）: そろえる条件からグレードを外した層。今日が G1・SG でなければラウンドを外した層。
    どちらも外せない日（予選の一般戦など）は、そろえる条件の3つだけ（＝同じ層）"""
    if cond["grade_g1plus"]:
        return cond | {"grade_g1plus": False}, "grade"
    if cond["round"] is not None:
        return cond | {"round": None}, "round"
    return cond, "none"


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


# 今日の展示の時点で決まる項目（出走表の時点は今日の値が無いので −1）。展示後の段は JS がこれだけを判定し直す
EXHIBITION_ITEMS = ("weather", "wind_bin", "wind_vector", "wave_bin", "exh_time_diff_6")


# ---------------------------------------------------------------- 全33項目の「同じ・近い」（spec B-6。mock-v16/knn2_report.py）
# 値: 2＝同じ、1＝近い、0＝違う、−1＝今日かそのレースのどちらかが欠損。基準の文言は screens・日本語の直し 24〜26（JS 側）
def venue_clusters(venue: np.ndarray, rank1: np.ndarray, pool: np.ndarray) -> dict[int, int]:
    """母集団の1号艇1着率で24場を6場ずつ4群（MD-6）"""
    p_in = pd.Series(rank1[pool] == 1).groupby(venue[pool]).mean().sort_values()
    return {int(v): gi for gi, g in enumerate(np.array_split(p_in.index.to_numpy(), 4)) for v in g}


def _rank_band(rank: np.ndarray) -> np.ndarray:
    return np.where(~np.isfinite(rank), -1, np.where(rank <= 2, 0, np.where(rank <= 4, 1, 2)))


def _b1_rank(x: np.ndarray) -> np.ndarray:
    b1 = x[:, 0]
    rk = 1 + (x[:, 1:] > b1[:, None]).sum(1).astype(float)
    return np.where(np.isfinite(b1), rk, np.nan)


def item_levels(races: pd.DataFrame, boats: dict[str, np.ndarray], qi: int, clusters: dict[int, int],
                is_kb: np.ndarray) -> dict[str, np.ndarray]:
    """races・boats（レース順、qi が今日のレース）の各レースについて、今日と比べた33項目の値 {項目: (n,) int8}"""
    import warnings

    n = len(races)
    none = np.zeros(n, bool)

    def lv(same, near, null):
        return np.where(null, -1, np.where(same, 2, np.where(near, 1, 0))).astype(np.int8)

    def mean_abs6(a):
        d = np.abs(a - a[qi][None, :])
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmean(np.where(np.isfinite(d), d, np.nan), axis=1)

    def thr(a, t_same, t_near):
        m = mean_abs6(np.asarray(a, dtype=float))
        return lv(m <= t_same, m <= t_near, ~np.isfinite(m))

    def band_adj(b, missing=-1):
        return lv(b == b[qi], np.abs(b - b[qi]) == 1, (b == missing) | (b[qi] == missing))

    B = boats
    venue = races["venue_code"].astype(int).to_numpy()
    vclu = np.array([clusters.get(int(v), -1) for v in venue])
    rn = races["race_number"].to_numpy(dtype=float)
    cls = np.asarray(B["cls_ord"], dtype=float)
    c1 = cls[:, 0]
    nat = np.asarray(B["nat_win"], dtype=float)
    gapb = gap_band(nat)
    natf = np.where(np.isfinite(nat), nat, -np.inf)
    top = natf.argmax(1) + 1
    second = np.argsort(-natf, axis=1, kind="stable")[:, 1] + 1
    nr = np.asarray(B["nat_win_rank"], dtype=float)
    same_nr = (nr == nr[qi]).sum(1)
    same_cls = (np.nan_to_num(cls, nan=-1) == np.nan_to_num(cls[qi], nan=-1)).sum(1)
    nA1 = (cls == 4).sum(1)
    gc = races["grade_code"].to_numpy(dtype=float)
    rc = races["round_code"].to_numpy(dtype=float)
    wc = races["weather_code"].to_numpy(dtype=float)
    ws = races["wind_speed"].to_numpy(dtype=float)
    wx = races["wind_x"].to_numpy(dtype=float)
    wy = races["wind_y"].to_numpy(dtype=float)
    wave = races["wave_height"].to_numpy(dtype=float)
    sday = races["series_day"].to_numpy(dtype=float)
    fin = races["is_final_day_num"].to_numpy(dtype=float)
    fin_null = ~np.isfinite(fin) | is_kb  # 長期の最終日は使えないので null 扱い
    nloc = np.nansum(B["is_local"], 1)
    rb = (rn - 1) // 4
    rain, dry = np.isin(wc, [2, 3]), np.isin(wc, [0, 1])
    wb = np.where(~np.isfinite(ws), -1, np.where(ws <= 2, 0, np.where(ws <= 4, 1, 2)))
    wd = np.sqrt((wx - wx[qi]) ** 2 + (wy - wy[qi]) ** 2)
    wvb = np.where(~np.isfinite(wave), -1, np.where(wave <= 2, 0, np.where(wave <= 5, 1, 2)))
    gb = np.where(~np.isfinite(gc), -1, np.where(gc == 0, 0, 1))
    b1n = nat[:, 0]
    return {
        "venue": lv(venue == venue[qi], vclu == vclu[qi], none),
        "race_number_band": band_adj(rb),
        "race_number": lv(rn == rn[qi], np.abs(rn - rn[qi]) <= 2, none),
        "b1_class": lv(c1 == c1[qi], np.abs(c1 - c1[qi]) == 1, ~np.isfinite(c1) | ~np.isfinite(c1[qi])),
        "class_all6": lv(same_cls == 6, same_cls >= 4, np.isnan(cls).all(1)),
        "n_A1": lv(nA1 == nA1[qi], np.abs(nA1 - nA1[qi]) == 1, none),
        "win_gap_band": band_adj(gapb, missing=5),
        "top_boat": lv(top == top[qi], second == top[qi], ~np.isfinite(nat).any(1)),
        "nat_win_6": thr(nat, 0.5, 0.8),
        "nat_win_rank_4": lv(same_nr >= 4, same_nr >= 2, ~np.isfinite(nr).any(1)),
        "b1_nat_win": lv(np.abs(b1n - b1n[qi]) <= 0.5, np.abs(b1n - b1n[qi]) <= 1.0, ~np.isfinite(b1n)),
        "loc_win_6": thr(B["loc_win"], 0.75, 1.2),
        "recent_win30_6": thr(B["recent_win30"], 0.10, 0.15),
        "recent_top3_30_6": thr(B["recent_top3_30"], 0.10, 0.15),
        "st_mean30_6": thr(B["st_mean30"], 0.02, 0.03),
        "b1_st_rank_band": band_adj(_rank_band(np.asarray(B["st_mean30_rank"], dtype=float)[:, 0])),
        "b1_motor_rank_band": band_adj(_rank_band(_b1_rank(np.asarray(B["motor_2"], dtype=float)))),
        "motor_2_6": thr(B["motor_2"], 5, 8),
        "b1_boat_rank_band": band_adj(_rank_band(_b1_rank(np.asarray(B["boat_2"], dtype=float)))),
        "boat_2_6": thr(B["boat_2"], 5, 8),
        "weather": lv(wc == wc[qi], (rain & rain[qi]) | (dry & dry[qi]), ~np.isfinite(wc) | ~np.isfinite(wc[qi])),
        "wind_bin": band_adj(wb),
        "wind_vector": lv(wd <= 1.5, wd <= 2.5, ~np.isfinite(wd)),
        "wave_bin": band_adj(wvb),
        "grade": lv(gc == gc[qi], np.abs(gc - gc[qi]) == 1, ~np.isfinite(gc) | ~np.isfinite(gc[qi])),
        "grade_bin": lv(gb == gb[qi], none, (gb == -1) | (gb[qi] == -1)),
        "round": lv(rc == rc[qi], (np.abs(rc - rc[qi]) == 1) & (rc != 3) & (rc[qi] != 3),
                    ~np.isfinite(rc) | ~np.isfinite(rc[qi])),
        "series_day": lv(sday == sday[qi], np.abs(sday - sday[qi]) == 1, ~np.isfinite(sday) | ~np.isfinite(sday[qi])),
        "is_final_day": lv(fin == fin[qi], none, fin_null),
        "age_6": thr(B["age"], 3, 5),
        "weight_6": thr(B["weight"], 2, 3),
        "n_local": lv(nloc == nloc[qi], np.abs(nloc - nloc[qi]) == 1, np.isnan(np.asarray(B["is_local"], float)).all(1)),
        "exh_time_diff_6": thr(B["exh_time_diff"], 0.03, 0.05),
    }


# ---------------------------------------------------------------- 33項目の表示用の値（spec B-6・B-7。画面の「今日: …」と見比べ）
# 画面（src/utils/analogySimilarDisplay.js）が項目ごとの文に組み立てる元の値。数値は丸めて整数・小数で持つ（大きさを抑える）。
# 艇別は6艇の配列。欠損は null
DISPLAY_BOAT = (("nat", "nat_win", 2), ("nat_rank", "nat_win_rank", 0), ("loc", "loc_win", 2),
                ("rw", "recent_win30", 3), ("rt3", "recent_top3_30", 3), ("st", "st_mean30", 3),
                ("motor", "motor_2", 1), ("boat", "boat_2", 1), ("age", "age", 0), ("weight", "weight", 1),
                ("cls", "cls_ord", 0), ("local", "is_local", 0), ("exh_diff", "exh_time_diff", 2))
DISPLAY_RACE = (("rn", "race_number", 0), ("sday", "series_day", 0), ("final", "is_final_day_num", 0),
                ("weather", "weather_code", 0), ("ws", "wind_speed", 0), ("wx", "wind_x", 1), ("wy", "wind_y", 1),
                ("wave", "wave_height", 0))


def _num(v, nd):
    if v is None or not np.isfinite(v):
        return None
    return int(round(float(v))) if nd == 0 else round(float(v), nd)


def display_columns(races: pd.DataFrame, boats: dict[str, np.ndarray], idx: np.ndarray, is_kb: np.ndarray) -> dict:
    """idx のレースの表示用の値を列で（{名前: [件ごとの値]}。艇別は件ごとに6艇の配列）。長期の最終日は使えないので null"""
    out = {}
    for name, col, nd in DISPLAY_BOAT:
        a = np.asarray(boats[col], dtype=float)[idx]
        out[name] = [[_num(v, nd) for v in row] for row in a]
    for name, col, nd in DISPLAY_RACE:
        v = races[col].to_numpy(dtype=float)[idx]
        if name == "final":
            v = np.where(is_kb[idx], np.nan, v)
        out[name] = [_num(x, nd) for x in v]
    out["grade"] = [None if pd.isna(g) else str(g) for g in races["grade"].to_numpy(dtype=object)[idx]]
    out["round"] = [None if pd.isna(g) else str(g) for g in races["round"].to_numpy(dtype=object)[idx]]
    out["venue"] = [int(v) for v in races["venue_code"].to_numpy()[idx]]
    return out


def display_row(cols: dict, k: int) -> dict:
    """display_columns の k 件目"""
    return {name: v[k] for name, v in cols.items()}
