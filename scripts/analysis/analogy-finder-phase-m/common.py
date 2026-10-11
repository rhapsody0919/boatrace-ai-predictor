"""BOA-271 Phase M 共通: テーマ定義・指標・基準・ブートストラップ・学習"""

from __future__ import annotations

import numpy as np
import pandas as pd
import lightgbm as lgb
from scipy.optimize import minimize_scalar

from build_dataset import D  # noqa: F401  (データ置き場)

THEMES = {
    "会場×枠・進入": ["venue_code", "boat_number", "race_number"],
    "選手・基礎成績": ["cls_ord", "nat_win", "nat_2", "loc_win", "loc_2",
                 "recent_win30", "recent_top3_30", "nat_win_diff", "nat_win_rank",
                 "loc_win_diff", "loc_win_rank", "recent_win30_diff",
                 "recent_win30_rank", "b1_cls_ord", "b1_nat_win"],
    "ST・直前情報": ["exh_time", "exh_time_diff", "exh_time_rank", "st_mean30", "st_n",
                "st_mean30_diff", "st_mean30_rank"],
    "機力": ["motor_2", "boat_2", "motor_2_diff", "motor_2_rank", "boat_2_diff",
           "boat_2_rank"],
    "環境": ["weather_code", "wind_x", "wind_y", "wind_speed", "wave_height",
           "grade_code", "round_code", "series_day", "is_final_day_num"],
    "選手・属性": ["age", "weight", "branch_code", "is_local"],
}
BASE_FEATURES = [f for fs in THEMES.values() for f in fs]
CATEGORICAL = ["venue_code", "boat_number", "weather_code", "grade_code",
               "round_code", "branch_code"]
TARGETS = {"win": "y_win", "top2": "y_top2", "top3": "y_top3"}
EPS = 1e-12


def theme_of(feature: str, themes=THEMES) -> str:
    for t, fs in themes.items():
        if feature in fs:
            return t
    raise KeyError(feature)


# ---------------------------------------------------------------- 学習
DEFAULT_PARAMS = dict(objective="binary", learning_rate=0.08, num_leaves=63,
                      min_data_in_leaf=500, feature_fraction=0.8,
                      bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                      verbosity=-1, seed=42, num_threads=8)


def fit_lgb(tr: pd.DataFrame, va: pd.DataFrame, feats, target, params=None,
            max_rounds=1500, es=50):
    p = {**DEFAULT_PARAMS, **(params or {})}
    cats = [c for c in CATEGORICAL if c in feats]
    dtr = lgb.Dataset(tr[feats].astype(float), tr[target], categorical_feature=cats,
                      free_raw_data=True)
    dva = lgb.Dataset(va[feats].astype(float), va[target], reference=dtr,
                      categorical_feature=cats)
    m = lgb.train(p, dtr, max_rounds, valid_sets=[dva],
                  callbacks=[lgb.early_stopping(es, verbose=False)])
    return m


def raw_score(m, df, feats):
    return m.predict(df[feats].astype(float), num_iteration=m.best_iteration,
                     raw_score=True)


# ---------------------------------------------------------------- 6クラス（1着艇）
def race_matrix(df: pd.DataFrame, col: str) -> np.ndarray:
    """race_id×boat_number(1..6) の行列。df は race_id, boat_number 順で6艇そろい前提。"""
    return df[col].to_numpy().reshape(-1, 6)


def softmax_rows(z: np.ndarray, a: float = 1.0) -> np.ndarray:
    z = a * z
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(z: np.ndarray, y: np.ndarray) -> float:
    """y: 1着艇の index(0..5)。対数尤度最大の温度 a。"""
    def nll(a):
        p = softmax_rows(z, a)
        return -np.log(p[np.arange(len(y)), y] + EPS).mean()
    return float(minimize_scalar(nll, bounds=(0.05, 5.0), method="bounded").x)


def per_race_logloss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(p[np.arange(len(y)), y], EPS, 1))


def per_race_brier(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    oh = np.zeros_like(p)
    oh[np.arange(len(y)), y] = 1
    return ((p - oh) ** 2).sum(axis=1)


def winner_index(df: pd.DataFrame) -> np.ndarray:
    return race_matrix(df, "y_win").argmax(axis=1)


# ---------------------------------------------------------------- 基準（MD-5 基準1）
def baseline_winner(train: pd.DataFrame, test: pd.DataFrame, strength=30.0):
    """会場×1号艇の級別ごとの1着艇の経験分布（train 期間で数える）。
    Dirichlet 平滑化: 会場×級別 → 会場 → 全体 の順に、親の分布を事前分布（強さ strength）にする。"""
    def races(df):
        r = df[df["boat_number"] == 1][["race_id", "venue_code", "b1_cls_ord"]].copy()
        w = df[df["y_win"] == 1][["race_id", "boat_number"]].rename(columns={"boat_number": "win_boat"})
        return r.merge(w, on="race_id")
    tr = races(train)
    glob = np.bincount(tr["win_boat"] - 1, minlength=6).astype(float)
    glob = (glob + 1) / (glob.sum() + 6)
    ven = {}
    for v, g in tr.groupby("venue_code"):
        c = np.bincount(g["win_boat"] - 1, minlength=6)
        ven[v] = (c + strength * glob) / (c.sum() + strength)
    vc = {}
    for (v, k), g in tr.groupby(["venue_code", "b1_cls_ord"]):
        c = np.bincount(g["win_boat"] - 1, minlength=6)
        vc[(v, k)] = (c + strength * ven[v]) / (c.sum() + strength)
    te = test[test["boat_number"] == 1][["race_id", "venue_code", "b1_cls_ord"]]
    out = np.vstack([vc.get((v, k), ven.get(v, glob)) for v, k in
                     zip(te["venue_code"], te["b1_cls_ord"])])
    return out  # test の race 順（race_id, boat_number 順で並んでいる前提）


def baseline_topk(train: pd.DataFrame, test: pd.DataFrame, target: str, strength=30.0):
    """艇単位の基準: 会場×1号艇の級別×艇番 の過去の target 率（親=会場×艇番）。"""
    g1 = train.groupby(["venue_code", "boat_number"])[target].agg(["sum", "count"])
    p1 = (g1["sum"] + 1) / (g1["count"] + 2)
    g2 = train.groupby(["venue_code", "b1_cls_ord", "boat_number"])[target].agg(["sum", "count"])
    prior = p1.reindex(pd.MultiIndex.from_arrays([g2.index.get_level_values(0),
                                                  g2.index.get_level_values(2)])).to_numpy()
    p2 = pd.Series((g2["sum"].to_numpy() + strength * prior) / (g2["count"].to_numpy() + strength),
                   index=g2.index)
    key = pd.MultiIndex.from_frame(test[["venue_code", "b1_cls_ord", "boat_number"]])
    out = p2.reindex(key).to_numpy()
    fb = p1.reindex(pd.MultiIndex.from_frame(test[["venue_code", "boat_number"]])).to_numpy()
    return np.where(np.isnan(out), fb, out)


def binary_ll(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


# ---------------------------------------------------------------- 比較・CI
def paired_ci(diff: np.ndarray, n_boot=2000, seed=0, clusters=None):
    """レース単位ペア差の平均と95%CI。clusters を渡すとクラスタ（日）単位のブートストラップも返す。"""
    rng = np.random.default_rng(seed)
    n = len(diff)
    means = np.empty(n_boot)
    for b in range(n_boot):
        means[b] = diff[rng.integers(0, n, n)].mean()
    out = {"mean": float(diff.mean()), "ci95": [float(np.percentile(means, 2.5)),
                                              float(np.percentile(means, 97.5))],
           "n": int(n)}
    if clusters is not None:
        codes, inv = np.unique(clusters, return_inverse=True)
        s = np.bincount(inv, weights=diff)
        c = np.bincount(inv)
        k = len(codes)
        cm = np.empty(n_boot)
        for b in range(n_boot):
            idx = rng.integers(0, k, k)
            cm[b] = s[idx].sum() / c[idx].sum()
        out["ci95_day_cluster"] = [float(np.percentile(cm, 2.5)),
                                   float(np.percentile(cm, 97.5))]
    return out


def calibration_deciles(p: np.ndarray, y: np.ndarray, n_bins=10):
    """艇単位の予測確率 vs 実際の率（10分位）。"""
    q = pd.qcut(p, n_bins, labels=False, duplicates="drop")
    d = pd.DataFrame({"q": q, "p": p, "y": y})
    t = d.groupby("q").agg(n=("y", "size"), pred=("p", "mean"), actual=("y", "mean"))
    t["gap"] = t["actual"] - t["pred"]
    return [{k: (round(float(v), 4) if k != "n" else int(v)) for k, v in r.items()}
            for r in t.reset_index().to_dict("records")]


# ---------------------------------------------------------------- SHAP
def theme_shares(contrib: np.ndarray, feats, themes=THEMES, mask=None):
    """平均|SHAP| をテーマごとに合算して全体で割る（期待値列は除く）。"""
    c = np.abs(contrib[:, :-1])
    if mask is not None:
        c = c[mask]
    per_feat = c.mean(axis=0)
    tot = per_feat.sum()
    shares = {}
    for t, fs in themes.items():
        idx = [feats.index(f) for f in fs if f in feats]
        shares[t] = float(per_feat[idx].sum() / tot) if idx else 0.0
    feat_share = {f: float(v / tot) for f, v in zip(feats, per_feat)}
    return shares, feat_share, int(c.shape[0])


def complete_races(df: pd.DataFrame) -> pd.DataFrame:
    d = df[df["race_ok"]].sort_values(["race_date", "race_id", "boat_number"])
    return d.reset_index(drop=True)
