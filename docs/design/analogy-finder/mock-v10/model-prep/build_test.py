"""model-prep 1/3: 本番の版（2026-10-02）を学習したコード（train-analogy.yml run 36968972725、headSha dc6d02084）の
features.py で全期間の特徴量を作り、train.py と同じ split で test を切り出して保存する。

- features.py は code-at-train/（git show dc6d02084:scripts/ml/analogy/features.py）。master の features.py は
  この版の後に定義が変わっている（体重・支部を前日まで、節の日目を race_series から、2連率を toFixed(1)、無風の扱い）
- データは fetch_data.mjs が書いた data/（長期は Storage のキャッシュ＝学習時と同じファイル、本体は今日 DB から SELECT）
- split: train.py と同じ（データの最終日から遡る12か月）。ただし本体を今日読んだので、2026-10-03 以降を先に落とし、
  最終日を版の test の終わり 2026-10-02 にそろえる

使い方: ANALOGY_DATA_DIR=data DYLD_FALLBACK_LIBRARY_PATH=... venv/bin/python build_test.py
出力: work/test.pkl（test の完全レース、全列）・work/build_info.json
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
import features as F  # noqa: E402

VERSION_TEST_END = pd.Timestamp("2026-10-02")
TEST_MONTHS = 12


def main():
    t0 = time.time()
    work = HERE / "work"
    work.mkdir(exist_ok=True)
    df = F.build(F.D)
    print(f"built {len(df):,} rows ({time.time() - t0:.0f}s)", flush=True)
    all_rows = df[df["race_date"] <= VERSION_TEST_END]
    df = F.complete_races(all_rows)
    end = df["race_date"].max()
    test_from = end - pd.DateOffset(months=TEST_MONTHS) + pd.Timedelta(days=1)
    test = df[df["race_date"] >= test_from].reset_index(drop=True)
    # 完全レースでない test 期間のレースも、計算1 の例のレースがそちらにある場合に備えて別に保存
    test_all = all_rows[all_rows["race_date"] >= test_from].reset_index(drop=True)
    test.to_pickle(work / "test.pkl")
    test_all.to_pickle(work / "test_all_rows.pkl")
    info = {"data_max_date": str(df["race_date"].max().date()), "test_from": str(test_from.date()),
            "test_to": str(test["race_date"].max().date()),
            "test_races": int(test["race_id"].nunique()), "test_rows": int(len(test)),
            "features_code": "dc6d02084:scripts/ml/analogy/features.py",
            "elapsed_s": round(time.time() - t0)}
    (work / "build_info.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
