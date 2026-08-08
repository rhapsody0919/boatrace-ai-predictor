"""ワトソン予想 推論スクリプト

学習済み LambdaRank モデル（watson_v1.pkl）で inference.csv のレースを予測し、
SHAP（pred_contrib）による診断ポイント付き JSON を出力する。
ローリング特徴量のために履歴（dataset.csv / start_timings.csv）を連結する
（predict.py と同じ流儀）。

実行:
  scripts/ml/.venv/bin/python scripts/ml/predict_watson.py
出力:
  data/ml/watson-predictions.json
    [{ race_id, rank_order, win_probs, scores, explanations, model_trained_at }]
"""

from __future__ import annotations

import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

import features as F

MODEL_DIR = Path(__file__).resolve().parent / "models"

# 特徴量の日本語ラベル（診断ポイント表示用）
FEATURE_LABELS = {
    "boat_number": "艇番（コース）",
    "venue_code": "会場特性",
    "race_number": "レース番号",
    "grade_ord": "級別",
    "age": "年齢",
    "win_rate": "全国勝率",
    "local_win_rate": "当地勝率",
    "global_2rate": "全国2連率",
    "global_3rate": "全国3連率",
    "local_2rate": "当地2連率",
    "local_3rate": "当地3連率",
    "motor_2rate": "モーター2連率",
    "motor_3rate": "モーター3連率",
    "boat_2rate": "ボート2連率",
    "boat_3rate": "ボート3連率",
    "exhibition_time": "展示タイム",
    "exhibition_st": "展示ST",
    "wind_direction_code": "風向",
    "weather_code": "天候",
    "wind_speed": "風速",
    "wave_height": "波高",
    "temperature": "気温",
    "water_temperature": "水温",
    "series_day": "節の経過日",
    "is_final_day_num": "最終日フラグ",
    "race_grade_code": "レースグレード",
    "st_hist_mean": "本番ST履歴（平均）",
    "st_hist_n": "ST履歴の厚み",
    "recent_win_rate": "直近の勝率",
    "recent_races": "直近の出走数",
    "win_rate_rank": "勝率のレース内順位",
    "win_rate_diff": "勝率のレース内差",
    "exh_time_rank": "展示タイムのレース内順位",
    "exh_st_rank": "展示STのレース内順位",
    "motor_2rate_rank": "モーターのレース内順位",
    "st_hist_rank": "STのレース内順位",
}

TOP_CONTRIB = 3


def softmax(scores: np.ndarray) -> np.ndarray:
    e = np.exp(scores - scores.max())
    return e / e.sum()


def main():
    inf_path = F.DATA_DIR / "inference.csv"
    if not inf_path.exists():
        raise SystemExit("❌ inference.csv がありません（export-inference-data.js を先に実行）")

    with open(MODEL_DIR / "watson_v1.pkl", "rb") as f:
        bundle = pickle.load(f)
    model = bundle["model"]
    prob_scale = bundle["prob_scale"]

    hist = pd.read_csv(F.DATA_DIR / "dataset.csv")
    st = pd.read_csv(F.DATA_DIR / "start_timings.csv")
    bf_path = F.DATA_DIR / "backfill_dataset.csv"
    if bf_path.exists():
        bf = pd.read_csv(bf_path)
        bf_st = pd.read_csv(F.DATA_DIR / "backfill_start_timings.csv")
        ids = set(hist["race_id"])
        hist = pd.concat([bf[~bf["race_id"].isin(ids)], hist], ignore_index=True)
        st = pd.concat([bf_st[~bf_st["race_id"].isin(ids)], st], ignore_index=True)

    inf = pd.read_csv(inf_path)
    out_path = F.DATA_DIR / "watson-predictions.json"
    if len(inf) == 0:
        out_path.write_text("[]")
        print("📭 推論対象なし")
        return

    target_ids = set(inf["race_id"])
    hist = hist[~hist["race_id"].isin(target_ids)]
    combined = pd.concat([hist, inf], ignore_index=True)
    feat = F.build_features(combined, st)
    today = feat[feat["race_id"].isin(target_ids)].copy()
    today = today.sort_values(["race_id", "boat_number"]).reset_index(drop=True)
    print(f"📊 推論対象: {today['race_id'].nunique()}レース {len(today)}行")

    X = today[F.FEATURE_COLS].astype(float)
    today["score"] = model.predict(X, num_iteration=model.best_iteration)
    contrib = model.predict(X, num_iteration=model.best_iteration, pred_contrib=True)
    # 末尾列は期待値（バイアス）項なので診断からは除外する
    contrib = np.asarray(contrib)[:, : len(F.FEATURE_COLS)]

    results = []
    for race_id, g in today.groupby("race_id", sort=True):
        scores = g["score"].to_numpy()
        probs = softmax(prob_scale * scores)
        boats = g["boat_number"].astype(int).tolist()
        order = [b for _, b in sorted(zip(-probs, boats))]

        explanations = {}
        for idx, boat in zip(g.index, boats):
            c = contrib[idx]
            top = np.argsort(-np.abs(c))[:TOP_CONTRIB]
            explanations[str(boat)] = [
                {
                    "feature": F.FEATURE_COLS[j],
                    "label": FEATURE_LABELS.get(F.FEATURE_COLS[j], F.FEATURE_COLS[j]),
                    "contrib": round(float(c[j]), 4),
                }
                for j in top
            ]

        results.append({
            "race_id": race_id,
            "rank_order": order,
            "win_probs": {str(b): round(float(p), 5) for b, p in zip(boats, probs)},
            "scores": {str(b): round(float(s), 4) for b, s in zip(boats, scores)},
            "explanations": explanations,
            "model_trained_at": bundle.get("trained_at"),
        })

    out_path.write_text(json.dumps(results, ensure_ascii=False))
    print(f"✅ watson: {len(results)}レース予測 → {out_path}")


if __name__ == "__main__":
    main()
