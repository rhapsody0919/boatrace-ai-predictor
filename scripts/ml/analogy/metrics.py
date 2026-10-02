"""BOA-271 学習の評価: 対数損失・基準（MD-5 基準1）・ペア差の CI

Phase M の scripts/analysis/analogy-finder-phase-m/common.py から、本番の品質ゲートに要る部分だけを移した。
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

EPS = 1e-12


def softmax_rows(z: np.ndarray, a: float = 1.0) -> np.ndarray:
    z = a * z
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(z: np.ndarray, y: np.ndarray) -> float:
    """z: レース×6艇の生スコア、y: 1着艇の index(0..5)。対数尤度が最大の温度。"""
    def nll(a):
        p = softmax_rows(z, a)
        return -np.log(p[np.arange(len(y)), y] + EPS).mean()
    return float(minimize_scalar(nll, bounds=(0.05, 5.0), method="bounded").x)


def per_race_logloss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(p[np.arange(len(y)), y], EPS, 1))


def binary_ll(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def winner_index(df: pd.DataFrame) -> np.ndarray:
    """race_id・boat_number 順で6艇そろった df の、1着艇の index。"""
    return df["y_win"].to_numpy().reshape(-1, 6).argmax(axis=1)


def baseline_winner(train: pd.DataFrame, test: pd.DataFrame, strength: float = 30.0) -> np.ndarray:
    """基準1: 会場×1号艇の級別ごとの過去の1着艇分布（会場→全体を事前分布にした Dirichlet 平滑化）。"""
    def races(df):
        r = df[df["boat_number"] == 1][["race_id", "venue_code", "b1_cls_ord"]]
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
    te = test[test["boat_number"] == 1][["venue_code", "b1_cls_ord"]]
    return np.vstack([vc.get((v, k), ven.get(v, glob)) for v, k in
                      zip(te["venue_code"], te["b1_cls_ord"])])


def baseline_topk(train: pd.DataFrame, test: pd.DataFrame, target: str, strength: float = 30.0) -> np.ndarray:
    """艇単位の基準: 会場×1号艇の級別×艇番の過去の率（親=会場×艇番）。"""
    g1 = train.groupby(["venue_code", "boat_number"])[target].agg(["sum", "count"])
    p1 = (g1["sum"] + 1) / (g1["count"] + 2)
    g2 = train.groupby(["venue_code", "b1_cls_ord", "boat_number"])[target].agg(["sum", "count"])
    prior = p1.reindex(pd.MultiIndex.from_arrays([g2.index.get_level_values(0),
                                                  g2.index.get_level_values(2)])).to_numpy()
    p2 = pd.Series((g2["sum"].to_numpy() + strength * prior) / (g2["count"].to_numpy() + strength),
                   index=g2.index)
    out = p2.reindex(pd.MultiIndex.from_frame(test[["venue_code", "b1_cls_ord", "boat_number"]])).to_numpy()
    fb = p1.reindex(pd.MultiIndex.from_frame(test[["venue_code", "boat_number"]])).to_numpy()
    return np.where(np.isnan(out), fb, out)


def paired_ci(diff: np.ndarray, clusters: np.ndarray, n_boot: int = 2000, seed: int = 0) -> dict:
    """レース単位のペア差の平均と、日単位のクラスタ・ブートストラップの95%CI。"""
    rng = np.random.default_rng(seed)
    codes, inv = np.unique(clusters, return_inverse=True)
    s = np.bincount(inv, weights=diff)
    c = np.bincount(inv)
    k = len(codes)
    means = np.empty(n_boot)
    for b in range(n_boot):
        idx = rng.integers(0, k, k)
        means[b] = s[idx].sum() / c[idx].sum()
    return {"mean": float(diff.mean()),
            "ci95": [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))],
            "n": int(len(diff)), "n_days": int(k)}
