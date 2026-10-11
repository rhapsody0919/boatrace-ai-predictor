"""BOA-271 MD-6: 主モデル（1着）の pred_contrib から k-NN の重みを作る

重み = 標本レース（pool の末尾 2025年から 5,000R、test は使わない）で、
艇ごとの SHAP をレース内で中心化した |SHAP| の平均を (特徴量, 艇番) ごとに取ったもの。
中心化の理由: 1着確率はレース内 softmax なので、6艇一様に効く部分は順位に影響しない。

使い方: python weights.py [model_file ...]（既定 main_win_F5.txt）
出力: data/ml/analogy/md6/weights_<model名>.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402

OUT = C.D / "md6"


def weights_for(model_path: Path, rows: pd.DataFrame) -> dict:
    m = lgb.Booster(model_file=str(model_path))
    feats = m.feature_name()
    assert feats == C.BASE_FEATURES, "特徴量の並びが Phase M と違う"
    contrib = m.predict(rows[feats].astype(float), pred_contrib=True)[:, :-1]
    c = contrib.reshape(-1, 6, len(feats))
    c = c - c.mean(axis=1, keepdims=True)
    w = np.abs(c).mean(axis=0)  # (6, F)
    return {"model": model_path.name, "num_trees": m.num_trees(), "n_races": int(c.shape[0]),
            "weights": {f: [float(x) for x in w[:, j]] for j, f in enumerate(feats)}}


def main():
    rows = pd.read_pickle(OUT / "shap_rows.pkl").sort_values(["race_id", "boat_number"])
    paths = [Path(p) for p in sys.argv[1:]] or [C.D / "main_win_F5.txt"]
    for p in paths:
        p = p if p.is_absolute() else C.D / p
        res = weights_for(p, rows)
        (OUT / f"weights_{p.stem}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
        tot = sum(sum(v) for v in res["weights"].values())
        top = sorted(((sum(v) / tot, f) for f, v in res["weights"].items()), reverse=True)[:12]
        print(p.name, res["num_trees"], [(f, round(s, 3)) for s, f in top])


if __name__ == "__main__":
    main()
