"""BOA-271 v16 の画面の純粋関数（src/utils/analogyFacts.js・wilson.js）の固定データを作る（tasks T6-2）。

Python の定義（v16_defs.rank_positions、spec A-7 の判定の3段階、Wilson の95%区間）で答えを作り、
scripts/maintenance/verify-analogy-facts.js が JS の答えと突き合わせる。
使い方: python make_v16_ui_cases.py （testdata/v16-ui-cases.json を上書き）
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from v16_defs import rank_positions

Z = 1.96
LARGE_GAP = 0.05


def wilson(x: int, n: int) -> list[float]:
    p = x / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [max(0.0, c - h), min(1.0, c + h)]


def judge(best: list[int], worst: list[int]) -> str:
    """spec A-7: ぶれ幅が重なる → unclear、重ならず差が5ポイント以上 → large、未満 → small"""
    bl, bh = wilson(*best)
    wl, wh = wilson(*worst)
    if bl <= wh and wl <= bh:
        return "unclear"
    return "large" if abs(best[0] / best[1] - worst[0] / worst[1]) >= LARGE_GAP else "small"


def main():
    rng = np.random.default_rng(0)
    ranks = []
    for _ in range(200):
        pool = rng.choice([0.1, 0.12, 0.15, 5.5, 6.0, 6.5, 7.0], size=6) if rng.random() < 0.5 \
            else np.round(rng.normal(6, 1, size=6), 2)
        v = [None if rng.random() < 0.08 else float(x) for x in pool]
        hib = bool(rng.random() < 0.5)
        arr = [np.nan if x is None else x for x in v]
        ranks.append({"values": v, "hib": hib, "positions": [sorted(p) for p in rank_positions(arr, hib)]})
    wil = []
    for _ in range(60):
        n = int(rng.integers(1, 3000))
        x = int(rng.integers(0, n + 1))
        wil.append({"x": x, "n": n, "interval": wilson(x, n)})
    judges = []
    for _ in range(150):
        nb, nw = int(rng.integers(5, 800)), int(rng.integers(5, 800))
        best = [int(rng.integers(0, nb + 1)), nb]
        worst = [int(rng.integers(0, nw + 1)), nw]
        judges.append({"best": best, "worst": worst, "level": judge(best, worst)})
    out = {"source": "scripts/ml/analogy/make_v16_ui_cases.py（seed 0）。JS の analogyFacts.js・wilson.js と "
                     "verify-analogy-facts.js で突き合わせる",
           "rank_positions": ranks, "wilson": wil, "judge": judges}
    path = Path(__file__).parent / "testdata" / "v16-ui-cases.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(path, len(ranks), len(wil), len(judges))


if __name__ == "__main__":
    main()
