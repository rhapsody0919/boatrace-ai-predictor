"""model-prep 2/3: test の pred_contrib（3モデル）と、本番 analogy_contribution_profiles の再現の確認。

- モデル: models/2026-10-02/model_{win,top2,top3}.txt（Storage の版をダウンロードしたもの）
- 入力の列の並びは booster.feature_name()（themes の並びに頼らない）
- 再現の確認: 全国・全グレード・全ラウンド・全艇（venue 0 / all / all / boat 0）の1〜3着のシェアを、
  profiles.py（学習時のコード）と同じ定義（艇ごとの |SHAP| の平均をテーマごとに合算して合計で割る。中心化しない）で出し、
  db_profiles_national.json（本番 DB から SELECT した値）と比べる。差の最大が 0.002 以内なら再現とする

出力: work/contrib_{win,top2,top3}.npy（float32、test.pkl の行順、最後の列が期待値）・work/pred_raw_*.npy・
      work/repro_check.json
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
from themes import THEMES, theme_features  # noqa: E402

VERSION = "2026-10-02"
MODELS = {"win": 1, "top2": 2, "top3": 3}
TOL = 0.002


def main():
    t0 = time.time()
    work = HERE / "work"
    test = pd.read_pickle(work / "test.pkl")
    db = json.loads((HERE / "db_profiles_national.json").read_text())
    out = {"model_version": VERSION, "tolerance": TOL, "n_races_rebuilt": int(test["race_id"].nunique()),
           "n_boats_rebuilt": int(len(test)), "targets": {}}
    for name, ft in MODELS.items():
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{name}.txt"))
        names = m.feature_name()
        x = test[names].astype("float32")
        c = m.predict(x, pred_contrib=True).astype("float32")
        np.save(work / f"contrib_{name}.npy", c)
        np.save(work / f"pred_raw_{name}.npy", m.predict(x, raw_score=True).astype("float32"))
        absmean = np.abs(c[:, :-1].astype("float64")).mean(axis=0)
        idx = {f: i for i, f in enumerate(names)}
        th = {t["key"]: float(sum(absmean[idx[f]] for f in theme_features(t))) for t in THEMES}
        tot = sum(th.values())
        shares = {k: v / tot for k, v in th.items()}
        ref = next(r for r in db if r["finish_target"] == ft)
        diffs = {k: shares[k] - ref["shares"][k] for k in shares}
        gb = {t["key"]: [{"key": g["key"], "share": float(sum(absmean[idx[f]] for f in g["features"]) / tot)}
                         for g in t["groups"]] for t in THEMES}
        gdiff = max(abs(a["share"] - b["share"]) for k in gb for a, b in zip(gb[k], ref["breakdown"][k]))
        out["targets"][name] = {
            "finish_target": ft, "feature_names": names,
            "shares_rebuilt": shares, "shares_db": ref["shares"], "diff": diffs,
            "max_abs_diff": max(abs(v) for v in diffs.values()),
            "breakdown_rebuilt": gb, "breakdown_max_abs_diff": gdiff,
            "n_races_db": ref["n_races"], "n_boats_db": ref["n_boats"],
            "period_db": [ref["period_from"], ref["period_to"]],
            "reproduced": max(abs(v) for v in diffs.values()) <= TOL and gdiff <= TOL,
        }
        print(name, json.dumps({k: round(v, 5) for k, v in diffs.items()}), f"({time.time() - t0:.0f}s)",
              flush=True)
    out["all_reproduced"] = all(v["reproduced"] for v in out["targets"].values())
    (work / "repro_check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("all_reproduced", out["all_reproduced"])


if __name__ == "__main__":
    main()
