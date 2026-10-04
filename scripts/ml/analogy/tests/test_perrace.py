"""レースごとの寄与度（B）の学習側の書き出し（perrace.py、plan「学習側の設計」）"""

import json

import numpy as np
import pandas as pd
import pytest

import features as F
import perrace as P
import train as T
from themes import FEATURES, LIVE_FEATURES, RACECARD_FEATURES, THEMES


def synthetic(n_races=240, start="2025-11-20", seed=0):
    """全特徴量を持つ完全レースの表（日付は KB_END をまたぐ）。"""
    rng = np.random.default_rng(seed)
    rows = n_races * 6
    df = pd.DataFrame({f: rng.normal(size=rows).astype("float32") for f in FEATURES})
    df["race_id"] = np.repeat(np.arange(n_races) + 202511200101, 6)
    df["race_date"] = np.repeat(pd.date_range(start, periods=n_races, freq="D"), 6)
    df["boat_number"] = np.tile(np.arange(1, 7), n_races).astype("float32")
    df["venue_code"] = np.repeat(rng.integers(1, 25, n_races), 6).astype("float32")
    df["branch_code"] = rng.integers(0, 5, rows).astype("float32")
    df["grade_code"] = np.repeat(rng.integers(0, 5, n_races), 6).astype("float32")
    df["round_code"] = np.repeat(rng.integers(0, 4, n_races), 6).astype("float32")
    df["weather_code"] = np.repeat(rng.integers(0, 3, n_races), 6).astype("float32")
    df.loc[df.index[:6], "round_code"] = np.nan
    win = np.zeros(rows, dtype="int8")
    win[np.arange(n_races) * 6 + rng.integers(0, 6, n_races)] = 1
    df["y_win"] = win
    df["exh_time_rank"] = df.groupby("race_id")["exh_time"].rank(method="min").astype("float32")
    return df


@pytest.fixture(scope="module")
def models():
    df = synthetic()
    old = T.PARAMS["min_data_in_leaf"]
    T.PARAMS["min_data_in_leaf"] = 20
    try:
        win = T.fit_model(df, "y_win", 20, 0)
        rc = T.fit_model(df, "y_win", 20, 0, RACECARD_FEATURES)
    finally:
        T.PARAMS["min_data_in_leaf"] = old
    return df, win, rc


def raw(df):
    """CSV の生の形（race_id は文字列）。"""
    ids = df["race_id"].unique()
    rid = [F.int_to_rid(r) for r in ids]
    cond = pd.DataFrame({"race_id": rid, "weather": "晴", "wind_direction": "北", "wind_speed": "2",
                         "wave_height": "3", "series_day": "2", "is_final_day": "false"})
    cond.loc[0, ["wind_direction", "wind_speed"]] = ["", "0"]
    cond.loc[1, ["wind_direction", "wind_speed"]] = ["", "4"]
    cond.loc[2, "weather"] = "雨"
    exh = pd.DataFrame({"race_id": np.repeat(rid, 6), "boat_number": np.tile(range(1, 7), len(rid)).astype(str),
                        "exhibition_time": "6.75", "is_absent": "false"})
    for d in (cond, exh):
        d["rid"] = P._rid_int(d["race_id"])
    return cond, exh


def test_racecard_model_uses_36_columns_without_live(models):
    _, _, rc = models
    assert rc.feature_name() == RACECARD_FEATURES and len(rc.feature_name()) == 36
    assert not set(LIVE_FEATURES) & set(rc.feature_name())


def test_per_race_meta_feature_names_follow_booster(models, tmp_path):
    _, win, rc = models
    dw, dr = P.model_dump(win, tmp_path / "w.json"), P.model_dump(rc, tmp_path / "r.json")
    meta = P.per_race_meta("v", (win, dw), (rc, dr), {"branch_code": {"東京": 0}})
    assert meta["models"]["win"]["feature_names"] == win.feature_name()
    assert meta["models"]["win_racecard"]["feature_names"] == rc.feature_name()
    assert meta["models"]["win"]["num_trees"] == 20
    assert meta["live_features"] == LIVE_FEATURES
    # 推論側の JS が本体の風向を同じ表で直す（windOffsetFor）
    assert meta["wind_basis"] == F.load_wind_basis()
    assert meta["themes"] == THEMES and "features" in meta["themes"][0]["groups"][0]
    assert meta["models"]["win"]["file"] == "model_win.json"
    assert set(win.feature_name()) == set(rc.feature_name()) | set(LIVE_FEATURES)
    assert json.loads((tmp_path / "w.json").read_text())["feature_names"] == win.feature_name()


def test_parity_selection_includes_edge_cases_and_only_main_period(models):
    df, _, _ = models
    cond, _ = raw(df)
    ids = P.select_parity_races(df, cond, n=50)
    assert len(ids) == 50 and len(set(ids)) == 50
    main_ids = set(df.loc[df["race_date"] > F.KB_END, "race_id"])
    assert set(ids) <= main_ids
    for edge in (cond.loc[0, "rid"], cond.loc[1, "rid"]):
        if edge in main_ids:
            assert edge in ids
    assert df.loc[df["round_code"].isna(), "race_id"].iloc[0] not in main_ids or \
        df.loc[df["round_code"].isna(), "race_id"].iloc[0] in ids
    assert P.select_parity_races(df, cond, n=50) == ids  # 決定的


def test_parity_fixture_contrib_sums_to_raw_score(models):
    df, win, rc = models
    cond, exh = raw(df)
    ids = P.select_parity_races(df, cond, n=5)
    fx = P.parity_fixture("v", df, ids, cond, exh, {"win": win, "win_racecard": rc})
    r0 = fx["races"][0]
    assert len(r0["racecard_features"]) == 6 and len(r0["racecard_features"][0]["features"]) == 36
    assert [b["boat_number"] for b in r0["racecard_features"]] == [1, 2, 3, 4, 5, 6]
    assert r0["live_raw"]["conditions"]["wind_speed"] is not None
    assert r0["live_raw"]["exhibition"][0]["exhibition_time"] == 6.75
    rows = df[df["race_id"] == ids[0]].sort_values("boat_number")
    for name, m in (("win", win), ("win_racecard", rc)):
        c = np.array(r0["expected"][name]["contrib"])
        rs = m.predict(rows[m.feature_name()].astype("float32"), raw_score=True)
        assert c.sum(axis=1) == pytest.approx(rs, abs=1e-9)
    # racecard_features は win_racecard の入力と同じ値
    assert [b["features"] for b in r0["racecard_features"]] == r0["expected"]["win_racecard"]["features"]


def test_centered_theme_shares_sum_to_one(models):
    df, win, _ = models
    s = df.iloc[:60]
    sh = P.centered_theme_shares(win.predict(s[win.feature_name()].astype("float32"), pred_contrib=True),
                                 win.feature_name())
    assert sh.shape == (10, len(THEMES))
    assert sh.sum(axis=1) == pytest.approx(np.ones(10))


def test_exhibition_effect_masks(models):
    df, _, _ = models
    n = df["race_id"].nunique()
    eff = P.exhibition_effect(np.full(n, 1.0), np.full(n, 1.1), df)
    assert eff["all"]["mean"] == pytest.approx(0.1)
    first = df[df["boat_number"] == 1]
    assert eff["unexplored"]["n"] == int((first["race_date"] < P.EXPLORED_FROM).sum()) < n


def test_missing_types_counts_splits(models):
    _, win, _ = models
    mt = P.missing_types(win.dump_model())
    assert sum(sum(v.values()) for v in mt.values()) > 0
    assert set(mt) <= set(win.feature_name())


def test_definition_record():
    cond = pd.DataFrame({"race_id": ["2026-03-01-01-01", "2026-03-02-01-01", "2026-03-03-02-01"],
                         "wind_direction": ["", "", "北"], "wind_speed": ["0", "3", "2"],
                         "series_day": ["1", "2", ""], "is_final_day": ["false", "true", ""]})
    series = pd.DataFrame({"venue_code": [1], "start_date": ["2026-03-01"], "end_date": ["2026-03-02"],
                           "grade": [None]})
    r = P.definition_record(cond, series, {"branch_code": {"a": 0, "b": 1}})
    assert r["calm_rows_wind_direction_blank_speed0"] == 1
    assert r["unknown_rows_wind_direction_blank_speed_pos"] == 1
    assert r["series_day_match_rate"] == 1.0 and r["is_final_day_match_rate"] == 1.0
    assert r["branch_map_size"] == 2


def test_fan_visible_record_shapes(models):
    df, win, rc = models
    rec = P.fan_visible_record(df, win, rc, [rc], n=30)
    assert rec["n_races"] == 30 and rec["scale"] == "sample30"
    assert set(rec["shares"]) == {"exhibition", "racecard"}
    assert rec["racecard_reseed"][0]["mean_abs_diff"] == pytest.approx(0.0)
    assert sum(rec["exhibition_pushed_boat"]["boat_number_counts"].values()) == 30
    assert 0 <= rec["chip_emphasis_rate"]["racecard"] <= 1
