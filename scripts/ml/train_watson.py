"""ワトソン予想: LightGBM LambdaRank

ポアロV2（ポジション別binaryヘッド）と異なり、レース内6艇の順位関係を
LambdaRank で直接学習するランキングモデル。

  - relevance: 1着=3, 2着=2, 3着=1, 着外=0（gain は 2^rel - 1）
  - スコア→勝率: レース内 softmax(a・score)。温度 a は calibration セットで
    1次元MLE（黄金分割探索）フィット
  - 評価は「市場への上乗せ」ΔR² = R²(Benter結合) − R²(オッズ単独) を含む
    （docs/proposal/holmes-model-methods-survey.md §2.2）。
    オッズは特徴量に入れない（日次推論時点で未存在のため学習/評価専用）

実行:
  scripts/ml/.venv/bin/python scripts/ml/train_watson.py
出力:
  scripts/ml/models/watson_v1.pkl    学習済みモデル一式
  data/ml/report_watson_v1.json      評価レポート
  data/watson/model.json             フロント表示用メタデータ（git管理）
"""

from __future__ import annotations

import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.metrics import log_loss, roc_auc_score

import features as F

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)
WATSON_DIR = Path(__file__).resolve().parents[2] / "data" / "watson"

LGB_PARAMS = dict(
    objective="lambdarank",
    metric="ndcg",
    ndcg_eval_at=[1, 3],
    learning_rate=0.03,
    num_leaves=63,
    min_data_in_leaf=50,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=1,
    lambda_l2=1.0,
    verbosity=-1,
    seed=42,
)
NUM_ROUNDS = 3000
EARLY_STOP = 100

RELEVANCE = {1: 3, 2: 2, 3: 1, 0: 0}


def make_rank_xy(df: pd.DataFrame):
    """レース単位でソートし X / relevance / group サイズ列を返す。"""
    d = df.sort_values(["race_id", "boat_number"]).reset_index(drop=True)
    X = d[F.FEATURE_COLS].astype(float)
    y = d["finish_pos"].map(RELEVANCE).astype(int)
    groups = d.groupby("race_id", sort=False).size().tolist()
    return d, X, y, groups


def golden_section_max(fn, lo, hi, tol=1e-4, max_iter=200):
    """1次元黄金分割探索（最大化）。train-adler-temps.js と同手法。"""
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


def fit_prob_scale(d_cal: pd.DataFrame) -> float:
    return golden_section_max(
        lambda a: winner_loglik(d_cal, softmax_by_race(d_cal, "score", a)),
        0.05, 10.0,
    )


def ndcg_at_k(d: pd.DataFrame, k: int) -> float:
    """レースごとの NDCG@k 平均（gain = 2^rel - 1）。"""
    vals = []
    for _, g in d.groupby("race_id", sort=False):
        rel_pred = g.sort_values("score", ascending=False)["rel"].to_numpy()[:k]
        rel_best = np.sort(g["rel"].to_numpy())[::-1][:k]
        disc = 1 / np.log2(np.arange(2, len(rel_pred) + 2))
        dcg = float(np.sum((2 ** rel_pred - 1) * disc))
        idcg = float(np.sum((2 ** rel_best - 1) * disc[: len(rel_best)]))
        if idcg > 0:
            vals.append(dcg / idcg)
    return float(np.mean(vals))


def top1_hit_rate(d: pd.DataFrame) -> float:
    hits = []
    for _, g in d.groupby("race_id", sort=False):
        pred = g.loc[g["score"].idxmax(), "boat_number"]
        actual = g.loc[g["finish_pos"] == 1, "boat_number"]
        if len(actual) == 1:
            hits.append(pred == actual.iloc[0])
    return float(np.mean(hits))


# ---------------------------------------------------------------------------
# Benter 結合と McFadden R²（ΔR² 評価）
# ---------------------------------------------------------------------------

def load_odds() -> pd.DataFrame | None:
    path = F.DATA_DIR / "odds.csv"
    if not path.exists():
        return None
    odds = pd.read_csv(path)
    cols = [f"odds_win_{b}" for b in range(1, 7)]
    odds = odds[(odds[cols] > 1).all(axis=1)]
    # implied 確率（控除率込みのまま正規化）
    inv = 1 / odds[cols]
    q = inv.div(inv.sum(axis=1), axis=0)
    long = []
    for b in range(1, 7):
        long.append(pd.DataFrame({
            "race_id": odds["race_id"],
            "boat_number": b,
            "q": q[f"odds_win_{b}"],
        }))
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
        np.clip(d["q"].to_numpy(), 1e-12, None))
    zmax = d.assign(_z=z).groupby("race_id")["_z"].transform("max").to_numpy()
    e = np.exp(z - zmax)
    tot = d.assign(_e=e).groupby("race_id")["_e"].transform("sum").to_numpy()
    return e / tot


def eval_delta_r2(d_odds: pd.DataFrame) -> dict:
    """オッズありレースを時系列で前半/後半に分け、前半でフィット・後半で評価。"""
    race_order = (d_odds.drop_duplicates("race_id")
                  .sort_values(["race_date", "race_id"])["race_id"].tolist())
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
        lambda a: winner_loglik(d_fit, blend_probs(d_fit, a, 0.0)), 0.05, 5.0)
    b_only = golden_section_max(
        lambda b: winner_loglik(d_fit, blend_probs(d_fit, 0.0, b)), 0.05, 5.0)

    r2 = {
        "watson_only": mcfadden_r2(d_ev, blend_probs(d_ev, a_only, 0.0)),
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


def main():
    print("📥 データ読み込み・特徴量構築...")
    df = F.load_dataset()
    train, cal, test = F.time_split(df)
    print(f"  train={train['race_id'].nunique()}R  cal={cal['race_id'].nunique()}R  "
          f"test={test['race_id'].nunique()}R")

    _, X_tr, y_tr, g_tr = make_rank_xy(train)
    d_ca, X_ca, y_ca, g_ca = make_rank_xy(cal)
    d_te, X_te, _, _ = make_rank_xy(test)
    cat_idx = [F.FEATURE_COLS.index(c) for c in F.CATEGORICAL_COLS]

    print("⚡ LambdaRank 学習中...")
    dtrain = lgb.Dataset(X_tr, y_tr, group=g_tr, categorical_feature=cat_idx)
    dcal = lgb.Dataset(X_ca, y_ca, group=g_ca, reference=dtrain,
                       categorical_feature=cat_idx)
    model = lgb.train(
        LGB_PARAMS, dtrain, NUM_ROUNDS,
        valid_sets=[dcal],
        callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)],
    )
    print(f"    best_iteration = {model.best_iteration}")

    for d, X in ((d_ca, X_ca), (d_te, X_te)):
        d["score"] = model.predict(X, num_iteration=model.best_iteration)
        d["rel"] = d["finish_pos"].map(RELEVANCE)

    print("🌡️ 勝率変換の温度フィット（calibration セット）...")
    prob_scale = fit_prob_scale(d_ca)
    print(f"    prob_scale a = {prob_scale:.4f}")

    d_te["p_win"] = softmax_by_race(d_te, "score", prob_scale)

    y_win = (d_te["finish_pos"] == 1).astype(int)
    metrics = {
        "top1_hit_rate": round(top1_hit_rate(d_te), 4),
        "winner_logloss": round(
            float(log_loss(y_win, np.clip(d_te["p_win"], 1e-6, 1 - 1e-6))), 4),
        "auc": round(float(roc_auc_score(y_win, d_te["score"])), 4),
        "ndcg_at_1": round(ndcg_at_k(d_te, 1), 4),
        "ndcg_at_3": round(ndcg_at_k(d_te, 3), 4),
    }
    print(f"  top1的中率: {metrics['top1_hit_rate']*100:.1f}% | "
          f"勝者logloss: {metrics['winner_logloss']:.4f} | AUC: {metrics['auc']:.4f} | "
          f"NDCG@3: {metrics['ndcg_at_3']:.4f}")

    # ポアロV2 の参考値（週次学習のレポートから転記。同一 time_split 設定）
    vs_poirot = None
    v2_path = F.DATA_DIR / "report_lgbm_v2.json"
    if v2_path.exists():
        v2 = json.loads(v2_path.read_text())
        vs_poirot = {
            "auc": v2["metrics"].get("auc"),
            "winner_logloss_calibrated": v2["metrics"].get("log_loss_calibrated"),
            "win_hit_rate": v2.get("backtest_3head", {}).get("win_hit_rate"),
        }
        print(f"  （参考）ポアロV2: AUC {vs_poirot['auc']:.4f} | "
              f"的中率 {vs_poirot['win_hit_rate']*100:.1f}%")

    print("📈 ΔR² 評価（Benter結合 vs オッズ単独）...")
    delta = None
    odds_long = load_odds()
    if odds_long is not None:
        d_all = pd.concat([d_ca, d_te], ignore_index=True)
        d_all["f"] = softmax_by_race(d_all, "score", prob_scale)
        d_odds = d_all.merge(odds_long, on=["race_id", "boat_number"], how="inner")
        # 6艇分のオッズ・予測が揃うレースのみ
        full = d_odds.groupby("race_id")["boat_number"].size()
        d_odds = d_odds[d_odds["race_id"].isin(full[full == 6].index)]
        if d_odds["race_id"].nunique() >= 200:
            delta = eval_delta_r2(d_odds)
            print(f"    R²: watson単独 {delta['r2']['watson_only']:.4f} / "
                  f"オッズ単独 {delta['r2']['odds_only']:.4f} / "
                  f"結合 {delta['r2']['combined']:.4f} → ΔR² = {delta['delta_r2']:+.4f} "
                  f"(α={delta['alpha']:.3f}, β={delta['beta']:.3f}, "
                  f"eval {delta['n_eval_races']}R)")
        else:
            print(f"    ⚠️ オッズありレースが不足（{d_odds['race_id'].nunique()}R）→ スキップ")
    else:
        print("    ⚠️ odds.csv なし → スキップ（export-training-data.js を先に実行）")

    # SHAP（pred_contrib）動作検証: 寄与合計 + 期待値 = 生スコア
    contrib = model.predict(X_te.iloc[:6], num_iteration=model.best_iteration,
                            pred_contrib=True)
    raw = model.predict(X_te.iloc[:6], num_iteration=model.best_iteration)
    assert np.allclose(contrib.sum(axis=1), raw, atol=1e-6), "pred_contrib 不整合"
    print("🔬 pred_contrib（TreeSHAP）検証 OK")

    imp = sorted(zip(F.FEATURE_COLS, model.feature_importance("gain")),
                 key=lambda x: -x[1])[:12]
    print("\n  特徴量重要度 TOP12 (gain):")
    for name, v in imp:
        print(f"    {name:20s} {v:,.0f}")

    calib = F.calibration_table(d_te, "p_win")

    # ---- 保存 ----
    trained_at = datetime.now(timezone.utc).isoformat()
    with open(MODEL_DIR / "watson_v1.pkl", "wb") as f:
        pickle.dump({
            "model": model,
            "prob_scale": prob_scale,
            "blend": {"alpha": delta["alpha"], "beta": delta["beta"]} if delta else None,
            "feature_cols": F.FEATURE_COLS,
            "categorical_cols": F.CATEGORICAL_COLS,
            "trained_at": trained_at,
        }, f)

    report = {
        "model": "watson_v1",
        "architecture": "LightGBM LambdaRank + softmax temperature calibration",
        "params": {k: str(v) for k, v in LGB_PARAMS.items()},
        "best_iteration": int(model.best_iteration),
        "prob_scale": round(prob_scale, 4),
        "n_train_races": int(train["race_id"].nunique()),
        "n_test_races": int(test["race_id"].nunique()),
        "test_period": [str(test["race_date"].min().date()),
                        str(test["race_date"].max().date())],
        "metrics": metrics,
        "vs_poirot_v2": vs_poirot,
        "delta_r2_eval": delta,
        "feature_importance": [{"feature": n, "importance": round(float(v), 1)}
                               for n, v in imp],
        "calibration": calib.assign(bin=calib["bin"].astype(str)).to_dict("records"),
    }
    with open(F.DATA_DIR / "report_watson_v1.json", "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    WATSON_DIR.mkdir(parents=True, exist_ok=True)
    meta = {
        "model_id": "watson",
        "version": "v1",
        "trained_at": trained_at,
        "n_races": int(df["race_id"].nunique()),
        "n_features": len(F.FEATURE_COLS),
        "metrics": metrics,
        "vs_poirot_v2": vs_poirot,
        "delta_r2": delta["delta_r2"] if delta else None,
        "delta_r2_detail": ({"r2": delta["r2"],
                             "n_eval_races": delta["n_eval_races"]} if delta else None),
    }
    with open(WATSON_DIR / "model.json", "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 保存: {MODEL_DIR/'watson_v1.pkl'} / {F.DATA_DIR/'report_watson_v1.json'} / "
          f"{WATSON_DIR/'model.json'}")


if __name__ == "__main__":
    main()
