"""BOA-271 寄与度のテーマの大きさによる偏りの点検（1回きりの分析）

SHAP のシェアは、テーマに入る特徴の数で偏りうる（相関の強い特徴が多いテーマは |SHAP| を分け合う一方、
合算すると大きく見える）。racerRecord は約15特徴、venueCourse は3特徴。テーマごとに特徴をまとめて
並べ替えたときの対数損失の悪化（grouped permutation importance）は特徴の数に左右されにくいので、
これと SHAP のシェアの順位を比べ、順位が変わるかを記録する。

入力: ANALOGY_DATA_DIR の boats.pkl と out/model_win.txt・out/train_meta.json（train.py の出力）
出力: data/analysis/analogy-finder/theme-bias-check.json
使い方: ANALOGY_DATA_DIR=... python scripts/analysis/analogy-finder-theme-bias.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ml" / "analogy"))

import features as F  # noqa: E402
import metrics as M  # noqa: E402
from themes import THEMES, theme_features  # noqa: E402

N_RACES = 5000
REPEATS = 3


def main():
    out = F.D / "out"
    meta = json.loads((out / "train_meta.json").read_text())
    model = lgb.Booster(model_file=str(out / "model_win.txt"))
    feats = model.feature_name()
    temp = meta["metrics"]["win"]["temperature"]
    t_from, t_to = meta["metrics"]["periods"]["test"]
    df = F.complete_races(pd.read_pickle(F.D / "boats.pkl"))
    test = df[(df["race_date"] >= t_from) & (df["race_date"] <= t_to)]
    rng = np.random.default_rng(0)
    ids = rng.choice(test["race_id"].unique(), min(N_RACES, test["race_id"].nunique()), replace=False)
    s = test[test["race_id"].isin(ids)].sort_values(["race_date", "race_id", "boat_number"])
    x = s[feats].astype("float32").reset_index(drop=True)
    y = M.winner_index(s)

    def logloss(frame):
        z = model.predict(frame, raw_score=True).reshape(-1, 6)
        return float(M.per_race_logloss(M.softmax_rows(z, temp), y).mean())

    base = logloss(x)
    contrib = np.abs(model.predict(x, pred_contrib=True)[:, :-1]).mean(axis=0)
    total = contrib.sum()
    rows = []
    for t in THEMES:
        cols = theme_features(t)
        shap_share = float(sum(contrib[feats.index(c)] for c in cols) / total)
        drops = []
        for r in range(REPEATS):
            perm = x.copy()
            # テーマの特徴を同じ並べ替えでまとめて動かす（テーマ内の相関は保ち、他テーマとの対応だけを壊す）。
            # 艇（行）単位で並べ替える。レース単位（6行ずつ）で並べ替えると、どのレースも艇番1〜6が
            # 同じ位置に並んでいるので艇番が動かず、会場×枠の重要度を過小に測る（初回の点検で実際に起きた）
            idx = np.random.default_rng(100 + r).permutation(len(x))
            perm[cols] = x[cols].to_numpy()[idx]
            drops.append(logloss(perm) - base)
        rows.append({"theme": t["key"], "n_features": len(cols), "shap_share": shap_share,
                     "perm_logloss_increase": float(np.mean(drops)),
                     "perm_sd": float(np.std(drops, ddof=1))})
    perm_total = sum(max(r["perm_logloss_increase"], 0) for r in rows)
    for r in rows:
        r["perm_share"] = max(r["perm_logloss_increase"], 0) / perm_total
    rank = lambda key: [r["theme"] for r in sorted(rows, key=lambda r: -r[key])]  # noqa: E731
    result = {
        "model_version": meta["model_version"], "test_period": [t_from, t_to],
        "n_races": int(len(ids)), "repeats": REPEATS, "base_logloss": base,
        "themes": rows, "rank_by_shap": rank("shap_share"), "rank_by_permutation": rank("perm_share"),
        "top3_rank_same": rank("shap_share")[:3] == rank("perm_share")[:3],
    }
    path = ROOT / "data" / "analysis" / "analogy-finder" / "theme-bias-check.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
