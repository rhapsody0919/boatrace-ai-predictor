"""寄与度プロファイルの集計（Version 14・向き。spec FR-E、plan「向きの計算」）"""

import numpy as np
import pandas as pd
import pytest

import profiles as P

THEMES = [
    {"key": "a", "groups": [{"key": "a1", "label": "A1", "features": ["f1"]},
                            {"key": "a2", "label": "A2", "features": ["f2"]}]},
    {"key": "b", "groups": [{"key": "b1", "label": "B1", "features": ["f3"]}]},
]
FEATS = ["f1", "boat_number", "f2", "f3"]


def frame(n_races=2, venue=(1, 2), grade=("G1", None), rnd=("yosen", "yusho"), seed=0):
    rows = []
    for r in range(n_races):
        for b in range(1, 7):
            rows.append({"race_id": r, "boat_number": b, "venue_code": venue[r % len(venue)],
                         "grade": grade[r % len(grade)], "round": rnd[r % len(rnd)],
                         "race_date": pd.Timestamp("2026-01-01") + pd.Timedelta(days=r)})
    keys = pd.DataFrame(rows)
    rng = np.random.default_rng(seed)
    contrib = rng.normal(size=(len(keys), len(FEATS) + 1))  # 最後の列は期待値（pred_contrib の形）
    return keys, contrib


def pick(rows, venue=0, grade="all", rnd="all", boat=0):
    return next(r for r in rows if (r["venue_code"], r["grade"], r["round"], r["boat_number"])
                == (venue, grade, rnd, boat))


def v14(contrib, boat, cols):
    """手計算: 列の和 → レースの中で中心化 → 艇番の中で中心化 → |値| の平均"""
    g = contrib[:, cols].sum(axis=1).reshape(-1, 6)
    g = g - g.mean(axis=1, keepdims=True)
    y = g[:, boat - 1]
    return np.abs(y - y.mean()).mean()


def test_version14_double_centering_and_frame_excluded():
    keys, contrib = frame(n_races=20, venue=(1,), grade=("G1",), rnd=("yosen",))
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    r = pick(rows, boat=3)
    ma, mb = v14(contrib, 3, [0, 2]), v14(contrib, 3, [3])
    assert r["shares"]["a"] == pytest.approx(ma / (ma + mb))
    assert set(r["shares"]) == {"a", "b"}  # 枠は割合に入らない
    assert sum(r["shares"].values()) == pytest.approx(1.0)
    mf = v14(contrib, 3, [1])
    assert r["frame_ratio"] == pytest.approx(mf / (ma + mb))
    assert r["stage"] == "exhibition"


def test_six_boats_moving_together_has_no_share():
    """6艇で同じ値（レース全体で一緒に動く分）はレースの中の中心化で消える"""
    keys, contrib = frame(n_races=10, venue=(1,), grade=("G1",), rnd=("yosen",))
    contrib[:, 3] = np.repeat(np.arange(10.0), 6)  # f3（テーマ b）はレースごとに6艇同じ
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    assert pick(rows, boat=2)["shares"]["b"] == pytest.approx(0.0, abs=1e-12)


def test_boat1_group_is_added_to_national_only_for_boat1():
    themes = [{"key": "rec", "groups": [
        {"key": "national", "label": "N", "features": ["f1"]},
        {"key": "boat1", "label": "B1", "features": ["f2"]}]},
        {"key": "b", "groups": [{"key": "b1", "label": "B", "features": ["f3"]}]}]
    keys, contrib = frame(n_races=30, venue=(1,), grade=("G1",), rnd=("yosen",))
    rows = P.slice_profiles(keys, [contrib], FEATS, themes, finish_target=1)
    one, two = pick(rows, boat=1), pick(rows, boat=2)
    assert [g["key"] for g in one["breakdown"]["rec"]] == ["national"]
    assert [g["key"] for g in two["breakdown"]["rec"]] == ["national", "boat1"]
    # 1号艇の national の大きさは f1＋f2 の和
    m_nat = v14(contrib, 1, [0, 2])
    m_b = v14(contrib, 1, [3])
    assert one["breakdown"]["rec"][0]["share"] == pytest.approx(m_nat / (m_nat + m_b))


def test_slices_counts_and_unknown_grade_only_in_all():
    keys, contrib = frame()
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=2, stage="racecard")
    idx = {(r["venue_code"], r["grade"], r["round"], r["boat_number"]): r for r in rows}
    allrow = idx[(0, "all", "all", 0)]
    assert (allrow["n_races"], allrow["n_boats"]) == (2, 12)
    assert idx[(0, "all", "all", 3)]["n_boats"] == 2
    assert idx[(0, "G1", "all", 0)]["n_races"] == 1
    # グレード不明のレース（2本目）は「全グレード」にだけ入る
    assert not any(k[1] not in ("all", "G1") for k in idx)
    assert idx[(2, "all", "yusho", 0)]["n_races"] == 1
    assert (2, "G1", "all", 0) not in idx  # n=0 のセルは書かない
    assert all(r["finish_target"] == 2 and r["stage"] == "racecard" for r in rows)
    assert allrow["period_from"] == "2026-01-01" and allrow["period_to"] == "2026-01-02"


def test_rows_must_be_races_of_boats_1_to_6():
    keys, contrib = frame()
    with pytest.raises(ValueError, match="艇番1〜6"):
        P.slice_profiles(keys.iloc[::-1].reset_index(drop=True), [contrib], FEATS, THEMES)


def test_share_sd_across_seeds():
    keys, contrib = frame(n_races=6)
    other = contrib.copy()
    other[:, 3] *= 3
    rows = P.slice_profiles(keys, [contrib, other], FEATS, THEMES, finish_target=1)
    r = pick(rows)
    assert r["share_sd"]["b"] > 0
    assert r["share_sd"]["a"] == pytest.approx(r["share_sd"]["b"])  # 2テーマなので同じ大きさで逆に動く
    single = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    assert single[0]["share_sd"] is None


def test_racecard_model_drops_groups_not_in_model():
    keys, contrib = frame(n_races=6)
    feats = ["f1", "boat_number", "f2"]  # f3（テーマ b）が無いモデル
    rows = P.slice_profiles(keys, [contrib[:, [0, 1, 2, 4]]], feats, THEMES, finish_target=1)
    assert set(pick(rows)["shares"]) == {"a"}


def test_group_partly_missing_is_an_error():
    keys, contrib = frame()
    themes = THEMES + [{"key": "c", "groups": [{"key": "c1", "label": "C", "features": ["f3", "f9"]}]}]
    with pytest.raises(ValueError, match="f9"):
        P.slice_profiles(keys, [contrib], FEATS, themes, finish_target=1)


def test_day_bootstrap_sd_reflects_day_to_day_variation():
    """share_sd は seed の揺れに加えて、日単位のブートストラップでの揺れを含む"""
    rng = np.random.default_rng(1)
    keys, _ = frame(n_races=60, venue=(1,), grade=("G1",), rnd=("yosen",))
    keys["race_date"] = pd.Timestamp("2026-01-01") + pd.to_timedelta(keys["race_id"] // 2, unit="D")
    base = rng.normal(size=(len(keys), len(FEATS) + 1))
    stable = base.copy()
    stable[:, 3] = base[:, 0]  # テーマ b がテーマ a と常に同じ大きさ
    noisy = base.copy()
    noisy[:, 3] = base[:, 0] * np.repeat(rng.uniform(0.1, 5.0, 30), 12)  # 日によって大きさが変わる
    s_stable = P.slice_profiles(keys, [stable], FEATS, THEMES, finish_target=1, n_boot=50)
    s_noisy = P.slice_profiles(keys, [noisy], FEATS, THEMES, finish_target=1, n_boot=50)
    assert pick(s_noisy)["share_sd"]["b"] > pick(s_stable)["share_sd"]["b"]
    assert pick(s_noisy)["share_sd"]["b"] > 0.01


# ---------------------------------------------------------------- 向き
def test_bands_keep_ties_together_and_shift_boundary_after():
    x = np.array([1, 2, 2, 2, 3, 4, 5, 6, 7], dtype=float)  # n=9、境目 3・6。2 の塊は 1〜3番目にまたがる
    band, has_mid = P._bands(x)
    assert has_mid
    assert list(band) == [0, 0, 0, 0, 1, 1, 2, 2, 2]


def test_bands_few_values_are_per_value():
    band, has_mid = P._bands(np.array([0, 1, 1, 0, 1], dtype=float))
    assert not has_mid and list(band) == [0, 2, 2, 0, 2]
    band, _ = P._bands(np.array([1, 2, 3, 2], dtype=float))
    assert list(band) == [0, -1, 2, -1]  # 3種類: 真ん中の値は区分に入れない


@pytest.mark.parametrize("m,rho,expected", [
    ((0.0, 0.02, 0.0), 0.0, "middle"),
    ((0.02, 0.0, 0.02), 0.0, "none"),        # 両端で上がる形（Q-B）
    ((0.0, 0.01, 0.03), 0.5, "higher"),
    ((0.03, 0.01, 0.0), -0.5, "lower"),
    ((0.0, 0.01, 0.03), 0.2, "none"),        # |ρ| < 0.3
    ((0.0, 0.003, 0.005), 0.9, "none"),      # |m_高 − m_低| < 0.01
    ((0.0, float("nan"), 0.03), 0.5, "higher"),  # 中の区分が無い（値ごとの区分）
])
def test_judge_rules(m, rho, expected):
    assert P.judge(*m, rho) == expected


def _dir_frame(n_races=400, n_days=40):
    keys, contrib = frame(n_races=n_races, venue=(1,), grade=("G1",), rnd=("yosen",), seed=3)
    keys["race_date"] = pd.Timestamp("2026-01-01") + pd.to_timedelta(keys["race_id"] % n_days, unit="D")
    return keys, contrib


def test_numeric_direction_higher_and_unstable_becomes_none():
    keys, contrib = _dir_frame()
    rng = np.random.default_rng(5)
    x = rng.normal(size=len(keys))
    contrib[:, 0] = 0.2 * x  # a1（f1）は x が高いほど上がる
    contrib[:, 3] = rng.normal(scale=0.001, size=len(keys))  # b1（f3）は x と無関係で小さい
    values = pd.DataFrame({"xa": x, "xb": x})
    P.DIRECTION_FEATURE["a1"], P.DIRECTION_FEATURE["b1"] = "xa", "xb"
    try:
        rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1, values=values)
    finally:
        del P.DIRECTION_FEATURE["a1"], P.DIRECTION_FEATURE["b1"]
    r = pick(rows, boat=2)
    a1 = r["breakdown"]["a"][0]
    assert a1["direction"] == "higher" and a1["direction_basis"]["boot_agree"] >= 0.8
    assert r["breakdown"]["b"][0]["direction"] == "none"
    # 全国の行以外・艇番0 には向きを付けない
    assert "direction" not in pick(rows, boat=0)["breakdown"]["a"][0]
    assert "direction" not in pick(rows, venue=1, boat=2)["breakdown"]["a"][0]


def test_category_direction_up_down_and_small_values_excluded():
    keys, contrib = _dir_frame(n_races=1200)
    rng = np.random.default_rng(7)
    cat = rng.integers(0, 4, size=len(keys)).astype(float)
    cat[rng.random(len(keys)) < 0.02] = 9.0  # 件数200未満の値（除く）
    effect = np.select([cat == 0, cat == 1], [0.2, -0.2], 0.0)
    contrib[:, 0] = effect + rng.normal(scale=0.01, size=len(keys))
    values = pd.DataFrame({"grade_code": cat})
    P.CATEGORY_FEATURE["a1"] = "grade_code"
    try:
        rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1, values=values)
    finally:
        del P.CATEGORY_FEATURE["a1"]
    d = pick(rows, boat=4)["breakdown"]["a"][0]
    assert d["direction"]["up"][0] == "ippan" and d["direction"]["down"][0] == "G3"
    assert all(v["n"] >= P.CAT_MIN_N for v in d["direction_basis"]["values"])


def test_boat1_group_direction_is_varies_for_boats_2_to_6():
    themes = [{"key": "rec", "groups": [
        {"key": "national", "label": "N", "features": ["f1"]},
        {"key": "boat1", "label": "B1", "features": ["f2"]}]},
        {"key": "b", "groups": [{"key": "b1", "label": "B", "features": ["f3"]}]}]
    keys, contrib = _dir_frame(n_races=100)
    values = pd.DataFrame({"nat_win_diff": np.random.default_rng(1).normal(size=len(keys))})
    rows = P.slice_profiles(keys, [contrib], FEATS, themes, finish_target=1, values=values)
    assert pick(rows, boat=3)["breakdown"]["rec"][1] == {
        "key": "boat1", "share": pytest.approx(pick(rows, boat=3)["breakdown"]["rec"][1]["share"]),
        "direction": "varies", "direction_basis": None}
    assert "direction" in pick(rows, boat=1)["breakdown"]["rec"][0]


def test_direction_basis_is_strict_json_for_few_values_and_constant_y():
    """値ごとの区分（地元 0/1）の m_mid と、y が一定の ρ は NaN になる。素の NaN は PostgREST が
    「invalid json」で拒む（run 37278559069 の書き込みの失敗）ので null にする"""
    import json
    rng = np.random.default_rng(0)
    day = np.repeat(np.arange(40), 10)
    W = np.ones((5, 40))
    few = P.numeric_direction((rng.random(400) < 0.3).astype(float), rng.normal(size=400), day, W, 40)
    assert few["basis"]["m_mid"] is None
    flat = P.numeric_direction(rng.normal(size=400), np.zeros(400), day, W, 40)
    assert flat["basis"]["rho"] is None and flat["direction"] == "none"
    json.dumps([few, flat], allow_nan=False)
