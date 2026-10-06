"""BOA-271 Phase M — テーマ別シェアの安定性（seed を変えた再学習）

F5（train 〜2025-12-02、test 2026-04〜09）の1着モデルを、seed（学習レースの抽出・bagging・
feature_fraction）を変えて5回学習し、同じ SHAP 標本でテーマ別シェアと best_iteration のばらつきを出す。
加えて木の数を固定（5回の best_iteration の中央値）した場合のシェアも出す。
"""

from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd

import common as C
from train_main import FOLDS, PERIOD_HOLE, shap_sample, sl, split_inner

SEEDS = [0, 1, 2, 3, 4]


def main():
    df = pd.read_pickle(C.D / "boats.pkl")
    df = C.complete_races(df)
    df = df[~((df["race_date"] >= PERIOD_HOLE[0]) & (df["race_date"] <= PERIOD_HOLE[1]))]
    res = json.loads((C.D / "main_result.json").read_text())
    best = res["tuning"]["best"]
    feats = C.BASE_FEATURES
    _, a, b, c, d = FOLDS[-1]
    tr, te = sl(df, a, b), sl(df, c, d)
    s = shap_sample(te, np.random.default_rng(123))
    mask = s["in_random"].to_numpy()
    y_te = C.winner_index(te)
    runs = []
    models = []
    for seed in SEEDS:
        tr_in, es = split_inner(tr, 3, seed=seed)
        m = C.fit_lgb(tr_in, es, feats, "y_win", {**best, "seed": seed})
        t = C.fit_temperature(C.raw_score(m, es, feats).reshape(-1, 6), C.winner_index(es))
        p = C.softmax_rows(C.raw_score(m, te, feats).reshape(-1, 6), t)
        contrib = m.predict(s[feats].astype(float), num_iteration=m.best_iteration, pred_contrib=True)
        sh, _, _ = C.theme_shares(contrib, feats, mask=mask)
        runs.append({"seed": seed, "best_iteration": int(m.best_iteration),
                     "test_logloss": float(C.per_race_logloss(p, y_te).mean()), "shares": sh})
        models.append((m, seed))
        print(runs[-1], flush=True)
    n_fix = int(np.median([r["best_iteration"] for r in runs]))
    fixed = []
    for m, seed in models:
        contrib = m.predict(s[feats].astype(float), num_iteration=min(n_fix, m.num_trees()),
                            pred_contrib=True)
        sh, _, _ = C.theme_shares(contrib, feats, mask=mask)
        fixed.append({"seed": seed, "num_iteration": min(n_fix, m.num_trees()), "shares": sh})
    themes = list(C.THEMES)
    summ = {t: {"mean": float(np.mean([r["shares"][t] for r in runs])),
                "sd": float(np.std([r["shares"][t] for r in runs], ddof=1)),
                "min": float(np.min([r["shares"][t] for r in runs])),
                "max": float(np.max([r["shares"][t] for r in runs]))} for t in themes}
    summ_fixed = {t: {"mean": float(np.mean([r["shares"][t] for r in fixed])),
                      "sd": float(np.std([r["shares"][t] for r in fixed], ddof=1))} for t in themes}
    ranks = [tuple(sorted(themes, key=lambda t: -r["shares"][t])) for r in runs]
    out = {"fold": "F5", "n_shap_boats": int(mask.sum()), "runs": runs, "summary": summ,
           "fixed_num_iteration": n_fix, "fixed_runs": fixed, "summary_fixed": summ_fixed,
           "rank_orders": [list(r) for r in ranks], "rank_order_identical": len(set(ranks)) == 1}
    (C.D / "shap_stability.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps(summ, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
