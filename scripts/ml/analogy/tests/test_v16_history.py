"""v16 の履歴から作る値（今節の平均着順点・直近30走の平均ST。いずれも前日まで。tasks T2-1）"""
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import v16_history as H


def runs(rows):
    df = pd.DataFrame(rows, columns=["racer_id", "race_date", "race_number", "kind", "pos"])
    df["race_date"] = pd.to_datetime(df["race_date"])
    df["series_key"] = 1
    df["race_id"] = df.index.astype(str)
    return df


def test_series_score_excludes_same_day_and_counts_zero_runs():
    df = H.series_score_asof(runs([
        (1, "2026-09-25", 3, "finish", 1),   # 10
        (1, "2026-09-25", 9, "zero", None),  # F 等は 0点で数える
        (1, "2026-09-26", 2, "absent", None),  # 欠場は数えない
        (1, "2026-09-26", 8, "finish", 6),   # 1
        (1, "2026-09-27", 4, "finish", 2),
        (1, "2026-09-27", 11, "finish", 1),
    ]))
    by = df.set_index("race_number")
    assert np.isnan(by.loc[3, "value"]) and by.loc[3, "n_prior"] == 0
    assert np.isnan(by.loc[9, "value"])                      # 同じ日の前の走は含めない
    assert by.loc[8, "value"] == pytest.approx(5.0) and by.loc[8, "n_prior"] == 2
    assert by.loc[11, "value"] == pytest.approx(11 / 3) and by.loc[11, "n_prior"] == 3


def test_series_score_resets_at_new_series():
    df = runs([(1, "2026-09-25", 1, "finish", 1), (1, "2026-09-26", 1, "finish", 1)])
    df.loc[1, "series_key"] = 2
    out = H.series_score_asof(df)
    assert out["n_prior"].tolist() == [0, 0]


def test_assign_series_fallback_continuity():
    r = pd.DataFrame({"racer_id": 1, "race_id": ["a", "b", "c", "d"], "venue_code": [20, 20, 20, 20],
                      "race_date": pd.to_datetime(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10"]),
                      "race_number": 1, "series_day": [1, 2, 1, 1]})
    out = H.assign_series(r, pd.DataFrame(columns=["venue_code", "start_date", "end_date"]))
    k = out.set_index("race_id")["series_key"]
    assert k["a"] == k["b"] != k["c"] != k["d"]  # 日目が減ったら新しい節、5日以上空いたら新しい節


def hist(rows):
    df = pd.DataFrame(rows, columns=["racer_id", "race_date", "race_number", "st_ok"])
    df["race_date"] = pd.to_datetime(df["race_date"])
    return df


def test_rolling_st_previous_day_window_and_flying_counted_in_window():
    rows = [(1, f"2026-08-{d:02d}", 1, 0.20) for d in range(1, 30)]       # 29走 0.20
    rows += [(1, "2026-08-30", 1, np.nan)]                                 # 30走目は F（窓に数え、平均から除く）
    rows += [(1, "2026-08-31", 1, 0.10), (1, "2026-09-01", 1, 0.05), (1, "2026-09-01", 5, 0.01)]
    t = pd.DataFrame({"racer_id": [1, 1, 1], "race_date": pd.to_datetime(["2026-08-31", "2026-09-01",
                                                                           "2026-08-01"])})
    out = H.rolling_st_asof(hist(rows), t, keys=["racer_id"])
    # 8/31 の時点: 窓は 8/1〜8/30 の30走（F 1走）→ 29走の平均 0.20
    assert out.loc[0, "mean"] == pytest.approx(0.20) and out.loc[0, "n"] == 29
    # 9/1 の時点: 8/2〜8/31 の30走（F 1走、0.10 が1走）→ (28×0.20+0.10)/29。同じ日の 0.05・0.01 は入らない
    assert out.loc[1, "mean"] == pytest.approx(round((28 * 0.20 + 0.10) / 29, 4)) and out.loc[1, "n"] == 29
    assert np.isnan(out.loc[2, "mean"]) and out.loc[2, "n"] == 0


def test_rolling_st_by_racer_and_course():
    h = hist([(1, "2026-09-01", 1, 0.10), (1, "2026-09-02", 1, 0.20), (2, "2026-09-01", 1, 0.30)])
    h["course"] = [1, 4, 1]
    t = pd.DataFrame({"racer_id": [1, 1, 2], "course": [1, 4, 4], "race_date": pd.to_datetime(["2026-09-03"] * 3)})
    out = H.rolling_st_asof(h, t, keys=["racer_id", "course"])
    assert out["mean"].tolist()[:2] == pytest.approx([0.10, 0.20])
    assert out.loc[2, "n"] == 0


# ---- 本番の書き出しがあるときだけ: 例のレース 2026-09-27 若松12R の値（分析の資料）を再現する
REAL = Path(os.environ["ANALOGY_DATA_DIR"]) if os.environ.get("ANALOGY_DATA_DIR") else None
EXAMPLE = "2026-09-27-20-12"
needs_real = pytest.mark.skipif(REAL is None or not (REAL / "race_series.csv").exists(), reason="本番の書き出しが無い")


@needs_real
def test_example_race_series_score():
    # analysis/t1/t1-2-series-runs.json screen_impact.example_race
    runs_ = H.assign_series(H.series_runs(REAL), pd.read_csv(REAL / "race_series.csv"))
    ex = H.series_score_asof(runs_).query("race_id == @EXAMPLE").sort_values("boat_number")
    assert ex["value"].round(4).tolist() == [8.6667, 8.3333, 8.0, 7.7143, 7.3333, 6.6667]
    assert ex["n_prior"].tolist() == [6, 6, 7, 7, 6, 6]


@needs_real
def test_example_race_course_and_overall_st():
    import features as F
    import v16_pool as P
    rows = pd.concat([F.load_kb(REAL), F.load_main(REAL)], ignore_index=True)
    h = H.st_history(rows, P.load_races(REAL))
    t = h[h["race_id"] == 202609272012].sort_values("boat_number")[["racer_id", "race_date", "boat_number"]]
    t = t.assign(course=t["boat_number"])
    # slit-hint/slitpred2_hint.json example: C（このコース、枠なりの走だけ）・A（全体）
    c = H.rolling_st_asof(h[h["waku"]], t, keys=["racer_id", "course"])
    assert c["mean"].tolist() == pytest.approx([0.15, 0.1503, 0.1333, 0.1267, 0.142, 0.1755], abs=1e-4)
    assert c["n"].tolist() == [30, 30, 30, 30, 30, 29]
    a = H.rolling_st_asof(h, t, keys=["racer_id"])
    assert a["mean"].tolist() == pytest.approx([0.15, 0.1153, 0.13, 0.1087, 0.1183, 0.1787], abs=1e-4)


def test_venue_course_st_uses_waku_runs_before_the_day_and_skips_f():
    hist = pd.DataFrame({
        "venue_code": [20.0, 20.0, 20.0, 20.0, 1.0],
        "race_date": pd.to_datetime(["2026-09-25", "2026-09-26", "2026-09-26", "2026-09-27", "2026-09-25"]),
        "waku": [True, True, False, True, True],
        "course": [1.0, 1.0, np.nan, 1.0, 1.0],
        "st_ok": [0.10, 0.20, 0.30, 0.50, 0.90],
    })
    hist.loc[len(hist)] = [20.0, pd.Timestamp("2026-09-25"), True, 2.0, np.nan]  # F は st_ok が NaN
    out = H.venue_course_st(hist, 20, "2026-09-27")
    assert out["mean"][0] == pytest.approx(0.15) and out["n"][0] == 2  # 当日・枠なりでない・他会場は入れない
    assert out["mean"][1] is None and out["n"][1] == 0
