"""ワトソンの生スコアを別プロセスで計算するヘルパー

PyTorch と LightGBM は macOS で別々の OpenMP ランタイムを読み込み、同一
プロセス内で併用すると `OMP: Error #179 pthread_mutex_init failed` で落ちる。
マイクロフトの学習（torch）からワトソン（LightGBM）と比較したいので、
LightGBM 側だけを子プロセスに隔離する。

単体実行:
  python watson_scores.py <入力.npy> <出力.npy>
    入力: (n, len(FEATURE_COLS)) の float32 行列（標準化前の生値）
    出力: (n,) のワトソン生スコア
"""

from __future__ import annotations

import pickle
import subprocess
import sys
from pathlib import Path

import numpy as np

MODEL_PATH = Path(__file__).resolve().parent / "models" / "watson_v1.pkl"


def score_matrix(x: np.ndarray) -> np.ndarray:
    """このプロセス内でワトソンのスコアを計算する（子プロセス側の実体）。"""
    import pandas as pd  # noqa: PLC0415 - 子プロセスでのみ必要

    with open(MODEL_PATH, "rb") as f:
        bundle = pickle.load(f)
    model = bundle["model"]
    frame = pd.DataFrame(x, columns=bundle["feature_cols"]).astype(float)
    return model.predict(frame, num_iteration=model.best_iteration)


def score_via_subprocess(x: np.ndarray, workdir: Path) -> np.ndarray | None:
    """torch を読み込んだプロセスから安全に呼ぶための子プロセス実行。"""
    if not MODEL_PATH.exists():
        return None
    workdir.mkdir(parents=True, exist_ok=True)
    in_path = workdir / "_watson_in.npy"
    out_path = workdir / "_watson_out.npy"
    np.save(in_path, np.ascontiguousarray(x, dtype=np.float32))
    try:
        subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), str(in_path), str(out_path)],
            check=True,
            cwd=str(Path(__file__).resolve().parent),
            capture_output=True,
        )
        return np.load(out_path)
    except subprocess.CalledProcessError as err:
        print(f"    ⚠️ ワトソンスコア取得に失敗: {err.stderr.decode()[:200]}")
        return None
    finally:
        in_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    np.save(dst, score_matrix(np.load(src)))
