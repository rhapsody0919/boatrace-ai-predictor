"""マイクロフト予想 推論スクリプト

学習済み Transformer（mycroft_v1.pt）で inference.csv のレースを予測し、
attention pooling の重みから「どの過去レースを重視したか」を根拠として
出力する（＝UI の「マイクロフトの記憶」）。

履歴（dataset.csv / start_timings.csv）を当日行に連結してから系列を組む点は
predict.py / predict_watson.py と同じ流儀。

実行:
  scripts/ml/.venv-torch/bin/python scripts/ml/predict_mycroft.py
出力:
  data/ml/mycroft-predictions.json
    [{ race_id, rank_order, win_probs, scores, attention_evidence, model_trained_at }]
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

import features as F
import mycroft_sequences as MS
from mycroft_model import Mycroft

MODEL_DIR = Path(__file__).resolve().parent / "models"
TOP_EVIDENCE = 3
BATCH_RACES = 64

# 着順コード（mycroft_sequences.TOKEN_CAT_SPECS の finish_code）→ 表示ラベル
FINISH_LABELS = {1: "1着", 2: "2着", 3: "3着", 4: "着外", 0: "不明"}


def load_history():
    """学習時と同じ履歴（backfill 込み）を読む。"""
    hist = pd.read_csv(F.DATA_DIR / "dataset.csv")
    st = pd.read_csv(F.DATA_DIR / "start_timings.csv")
    bf_path = F.DATA_DIR / "backfill_dataset.csv"
    if bf_path.exists():
        bf = pd.read_csv(bf_path)
        bf_st = pd.read_csv(F.DATA_DIR / "backfill_start_timings.csv")
        ids = set(hist["race_id"])
        hist = pd.concat([bf[~bf["race_id"].isin(ids)], hist], ignore_index=True)
        st = pd.concat([bf_st[~bf_st["race_id"].isin(ids)], st], ignore_index=True)
    return hist, st


def main():
    inf_path = F.DATA_DIR / "inference.csv"
    if not inf_path.exists():
        raise SystemExit("❌ inference.csv がありません（export-inference-data.js を先に実行）")
    ckpt_path = MODEL_DIR / "mycroft_v1.pt"
    if not ckpt_path.exists():
        raise SystemExit("❌ mycroft_v1.pt がありません（train_mycroft.py を先に実行）")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    config = ckpt["config"]

    out_path = F.DATA_DIR / "mycroft-predictions.json"
    inf = pd.read_csv(inf_path)
    if len(inf) == 0:
        out_path.write_text("[]")
        print("📭 推論対象なし")
        return

    hist, st = load_history()
    target_ids = set(inf["race_id"])
    hist = hist[~hist["race_id"].isin(target_ids)]
    combined = pd.concat([hist, inf], ignore_index=True)
    df = F.build_features(combined, st)

    store = MS.SequenceStore(df, st, max_len=config["max_len"])
    store.set_num_norm(ckpt["token_mean"], ckpt["token_std"])
    race_index = MS.build_race_index(store.df, race_ids=target_ids)
    race_ids = sorted(race_index.keys())
    if not race_ids:
        out_path.write_text("[]")
        print("📭 6艇揃いの推論対象なし")
        return
    print(f"📊 推論対象: {len(race_ids)}レース")

    static_cat, static_cont_raw = MS.split_static(store.df)
    static_cont = np.nan_to_num(
        (static_cont_raw - ckpt["static_mean"]) / ckpt["static_std"], nan=0.0
    ).astype(np.float32)

    model = Mycroft(
        n_static_cont=config["n_static_cont"], max_len=config["max_len"]
    )
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    temperature = float(ckpt["temperature"])
    results = []

    with torch.no_grad():
        for start in range(0, len(race_ids), BATCH_RACES):
            chunk = race_ids[start : start + BATCH_RACES]
            rows = np.stack([race_index[rid] for rid in chunk])
            flat = rows.reshape(-1)
            cat, num, mask = store.gather(flat)
            b, k = rows.shape
            score, _, weights = model(
                torch.from_numpy(cat).view(b, k, cat.shape[1], cat.shape[2]),
                torch.from_numpy(num).view(b, k, num.shape[1], num.shape[2]),
                torch.from_numpy(mask).view(b, k, mask.shape[1]),
                torch.from_numpy(static_cat[flat]).view(b, k, -1),
                torch.from_numpy(static_cont[flat]).view(b, k, -1),
            )
            score = score.numpy()
            weights = weights.numpy()

            scaled = temperature * score
            scaled -= scaled.max(axis=1, keepdims=True)
            probs = np.exp(scaled)
            probs /= probs.sum(axis=1, keepdims=True)

            for i, rid in enumerate(chunk):
                boats = store.boat_numbers[rows[i]].astype(int).tolist()
                order = [int(b) for _, b in sorted(zip(-probs[i], boats))]

                evidence = {}
                for j, boat in enumerate(boats):
                    info = store.token_race_info(int(rows[i, j]))
                    w = weights[i, j]
                    cand = [
                        (float(w[p]), info[p])
                        for p in range(len(info))
                        if info[p] is not None and w[p] > 0
                    ]
                    cand.sort(key=lambda x: -x[0])
                    evidence[str(boat)] = [
                        {
                            "race_date": rec["race_date"],
                            "venue_code": rec["venue_code"],
                            "result": FINISH_LABELS.get(rec["finish_code"], "不明"),
                            "days_ago": rec["days_ago"],
                            "weight": round(weight, 4),
                        }
                        for weight, rec in cand[:TOP_EVIDENCE]
                    ]

                results.append(
                    {
                        "race_id": rid,
                        "rank_order": order,
                        "win_probs": {
                            str(b): round(float(p), 5)
                            for b, p in zip(boats, probs[i])
                        },
                        "scores": {
                            str(b): round(float(s), 4)
                            for b, s in zip(boats, score[i])
                        },
                        "attention_evidence": evidence,
                        "model_trained_at": ckpt.get("trained_at"),
                    }
                )

    out_path.write_text(json.dumps(results, ensure_ascii=False))
    print(f"✅ mycroft: {len(results)}レース予測 → {out_path}")


if __name__ == "__main__":
    main()
