"""Benter 二段階結合と ΔR² 評価（モデル非依存の共有ロジック）

ΔR² = R²(自前モデル×オッズの結合) − R²(オッズ単独) は、
「市場に対してどれだけ上乗せ情報を持つか」を測るこのプロジェクト共通の指標
（docs/proposal/holmes-model-methods-survey.md §2.2）。

ワトソン（LightGBM）とマイクロフト（Transformer）が同じ定義で比較できるよう、
評価ロジックはこの 1 ファイルに集約する。LightGBM/PyTorch いずれにも依存しない
（両者は macOS で OpenMP ランタイムが衝突するため、共有部を軽く保つ意味もある）。
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

import features as F


def golden_section_max(fn, lo, hi, tol=1e-4, max_iter=200):
    """1次元黄金分割探索（最大化）。"""
    gr = (np.sqrt(5) - 1) / 2
    a, b = lo, hi
    c, d = b - gr * (b - a), a + gr * (b - a)
    fc, fd = fn(c), fn(d)
    for _ in range(max_iter):
        if b - a < tol:
            break
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - gr * (b - a)
            fc = fn(c)
        else:
            a, c, fc = c, d, fd
            d = a + gr * (b - a)
            fd = fn(d)
    return (a + b) / 2


def softmax_by_race(d: pd.DataFrame, score_col: str, scale: float) -> np.ndarray:
    """レース内 softmax(scale・score)。数値安定化のためレース内最大値を引く。"""
    s = scale * d[score_col].to_numpy()
    smax = d.assign(_s=s).groupby("race_id")["_s"].transform("max").to_numpy()
    e = np.exp(s - smax)
    tot = d.assign(_e=e).groupby("race_id")["_e"].transform("sum").to_numpy()
    return e / tot


def winner_loglik(d: pd.DataFrame, probs: np.ndarray) -> float:
    """勝者の対数尤度合計（1レース=1項）。"""
    win = d["finish_pos"].to_numpy() == 1
    return float(np.sum(np.log(np.clip(probs[win], 1e-12, None))))


def load_odds() -> pd.DataFrame | None:
    """odds.csv を (race_id, boat_number, q) の縦持ちで読む。

    q は控除率込みのまま正規化した市場暗黙確率。
    """
    path = F.DATA_DIR / "odds.csv"
    if not path.exists():
        return None
    odds = pd.read_csv(path)
    cols = [f"odds_win_{b}" for b in range(1, 7)]
    odds = odds[(odds[cols] > 1).all(axis=1)]
    inv = 1 / odds[cols]
    q = inv.div(inv.sum(axis=1), axis=0)
    long = []
    for b in range(1, 7):
        long.append(
            pd.DataFrame(
                {
                    "race_id": odds["race_id"],
                    "boat_number": b,
                    "q": q[f"odds_win_{b}"],
                }
            )
        )
    return pd.concat(long, ignore_index=True)


def mcfadden_r2(d: pd.DataFrame, probs: np.ndarray) -> float:
    """勝者尤度ベースの McFadden R²（帰無 = レース内一様）。"""
    ll = winner_loglik(d, probs)
    n_units = d.groupby("race_id")["boat_number"].size()
    ll0 = float(np.sum(np.log(1 / n_units)))
    return 1 - ll / ll0


def blend_probs(d: pd.DataFrame, alpha: float, beta: float) -> np.ndarray:
    """P ∝ exp(α・ln f + β・ln q)（レース内正規化）。"""
    z = alpha * np.log(np.clip(d["f"].to_numpy(), 1e-12, None)) + beta * np.log(
        np.clip(d["q"].to_numpy(), 1e-12, None)
    )
    zmax = d.assign(_z=z).groupby("race_id")["_z"].transform("max").to_numpy()
    e = np.exp(z - zmax)
    tot = d.assign(_e=e).groupby("race_id")["_e"].transform("sum").to_numpy()
    return e / tot


def eval_delta_r2(d_odds: pd.DataFrame) -> dict:
    """オッズありレースを時系列で前半/後半に分け、前半でフィット・後半で評価。

    d_odds に必要な列: race_id, race_date, boat_number, finish_pos, f, q
    （f = 自前モデルの勝率、q = 市場暗黙確率）
    """
    race_order = (
        d_odds.drop_duplicates("race_id")
        .sort_values(["race_date", "race_id"])["race_id"]
        .tolist()
    )
    half = len(race_order) // 2
    fit_ids, ev_ids = set(race_order[:half]), set(race_order[half:])
    d_fit = d_odds[d_odds["race_id"].isin(fit_ids)]
    d_ev = d_odds[d_odds["race_id"].isin(ev_ids)]

    def nll(params):
        return -winner_loglik(d_fit, blend_probs(d_fit, params[0], params[1]))

    res = minimize(nll, x0=[0.5, 0.5], method="Nelder-Mead")
    alpha, beta = float(res.x[0]), float(res.x[1])
    # 単独モデルも同条件（前半でスケールをフィット）で比較する
    a_only = golden_section_max(
        lambda a: winner_loglik(d_fit, blend_probs(d_fit, a, 0.0)), 0.05, 5.0
    )
    b_only = golden_section_max(
        lambda b: winner_loglik(d_fit, blend_probs(d_fit, 0.0, b)), 0.05, 5.0
    )

    r2 = {
        "model_only": mcfadden_r2(d_ev, blend_probs(d_ev, a_only, 0.0)),
        "odds_only": mcfadden_r2(d_ev, blend_probs(d_ev, 0.0, b_only)),
        "combined": mcfadden_r2(d_ev, blend_probs(d_ev, alpha, beta)),
    }
    return {
        "alpha": alpha,
        "beta": beta,
        "n_fit_races": len(fit_ids),
        "n_eval_races": len(ev_ids),
        "r2": {k: round(v, 4) for k, v in r2.items()},
        "delta_r2": round(r2["combined"] - r2["odds_only"], 4),
    }
