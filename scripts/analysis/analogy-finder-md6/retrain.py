"""BOA-271 MD-6: 重みの再学習（近傍の入れ替わりの測定用）

F5 の1着モデルと同じ train 期間・ハイパーパラメータで、seed（学習レースの抽出・bagging・
feature_fraction）だけ変え、木の数を F5 本体と同じ本数に固定して学習し直す（early stopping なし）。
出力: data/ml/analogy/md6/main_win_F5_fix_seed<s>.txt
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402
from train_main import FOLDS, PERIOD_HOLE, sl, split_inner  # noqa: E402

SEEDS = [int(s) for s in sys.argv[1:]] or [1, 2]


def main():
    base = lgb.Booster(model_file=str(C.D / "main_win_F5.txt"))
    n_trees = base.num_trees()
    best = json.loads((C.D / "main_result.json").read_text())["tuning"]["best"]
    feats = C.BASE_FEATURES
    df = pd.read_pickle(C.D / "boats.pkl")[list(dict.fromkeys(["race_id", "race_date", "boat_number", "race_ok", "y_win"] + feats))]
    df = C.complete_races(df)
    df = df[~((df["race_date"] >= PERIOD_HOLE[0]) & (df["race_date"] <= PERIOD_HOLE[1]))]
    _, a, b, _, _ = FOLDS[-1]
    tr = sl(df, a, b)
    del df
    for seed in SEEDS:
        tr_in, _ = split_inner(tr, 3, seed=seed)
        p = {**C.DEFAULT_PARAMS, **best, "seed": seed, "num_threads": 4}
        cats = [c for c in C.CATEGORICAL if c in feats]
        ds = lgb.Dataset(tr_in[feats].astype(float), tr_in["y_win"], categorical_feature=cats)
        m = lgb.train(p, ds, n_trees)
        out = C.D / "md6" / f"main_win_F5_fix_seed{seed}.txt"
        m.save_model(str(out))
        print("saved", out.name, m.num_trees(), flush=True)


if __name__ == "__main__":
    main()
