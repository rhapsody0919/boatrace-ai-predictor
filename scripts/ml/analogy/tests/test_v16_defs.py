"""v16 の定義（plan「定義」の表の Python 側。tasks T2-1）。期待値は例のレース 2026-09-27 若松12R（モック・分析の資料）と境界"""
import numpy as np
import pytest

import v16_defs as V

# ---------------------------------------------------------------- 級別の組み合わせ・範囲キー


def test_class_combo_counts_a1_a2_b1_b2_regardless_of_boat():
    assert V.class_combo(["A1"] * 6) == "6-0-0-0"
    assert V.class_combo(["B1", "A1", "A2", "B1", "A1", "B1"]) == "2-1-3-0"


def test_class_combo_missing_class_is_none():
    assert V.class_combo(["A1", None, "A1", "A1", "A1", "A1"]) is None


def test_scope_keys_example_race_is_final():
    k = V.scope_keys(venue=20, classes=["A1"] * 6, boat=1, round_="yusho", grade="G1")
    assert k == {"VC": "VC:20:6-0-0-0:1A1", "NC": "NC:6-0-0-0:1A1", "NCR": "NCR:6-0-0-0:1A1:yusho",
                 "VA": "VA:20", "VG": "VG:20", "NA": "NA"}


def test_scope_keys_ncr_only_on_final_days_and_vg_only_g1_or_sg():
    k = V.scope_keys(venue=20, classes=["A1", "A2", "B1", "B1", "B1", "B2"], boat=3, round_="yosen",
                     grade="ippan")
    assert k == {"VC": "VC:20:1-1-3-1:3B1", "NC": "NC:1-1-3-1:3B1", "VA": "VA:20", "NA": "NA"}
    assert V.scope_keys(venue=1, classes=["A1"] * 6, boat=1, round_=None, grade="SG")["VG"] == "VG:1"


def test_default_scope_falls_back_to_nc_under_300():
    assert V.default_scope(n_vc=300) == "VC"
    assert V.default_scope(n_vc=299) == "NC"


# ---------------------------------------------------------------- 6艇中の順位と同じ値


def test_rank_positions_example_motor():
    # mark1.md の例のレース: モーター2連率（大きいほど良い）の min 順位
    v = np.array([34.18, 37.24, 39.01, 35.75, 35.87, 35.63])
    assert V.rank_positions(v, higher_is_better=True) == [{6}, {2}, {1}, {4}, {3}, {5}]


def test_rank_positions_example_exhibition_time_lower_is_better():
    v = np.array([6.79, 6.85, 6.81, 6.96, 6.86, 6.82])
    assert V.rank_positions(v, higher_is_better=False) == [{1}, {4}, {2}, {6}, {5}, {3}]


def test_rank_positions_ties_best_and_worst():
    # 1位タイの2艇はどちらも1位、最下位タイの2艇は min 順位（5位）と6位の両方
    v = np.array([7.0, 7.0, 6.0, 5.0, 4.0, 4.0])
    assert V.rank_positions(v, higher_is_better=True) == [{1}, {1}, {3}, {4}, {5, 6}, {5, 6}]


def test_rank_positions_missing_value_is_not_ranked():
    v = np.array([7.0, np.nan, 6.0, 5.0, 4.0, 3.0])
    r = V.rank_positions(v, higher_is_better=True)
    assert r[1] == set()
    assert r[5] == {5, 6}  # 欠損を除いた5艇の最下位


# ---------------------------------------------------------------- 進入の型


@pytest.mark.parametrize("course, expected", [
    ([1, 2, 3, 4, 5, 6], "waku"),
    ([2, 1, 3, 4, 5, 6], "inlost"),
    ([1, 3, 4, 5, 6, 2], "mae6"),    # 6号艇が2コース
    ([1, 3, 4, 5, 2, 6], "mae5"),
    ([1, 4, 5, 6, 2, 3], "mae56"),
    ([1, 2, 4, 3, 5, 6], "maeOther"),  # 4号艇が3コース
    ([1, 2, 3, 4, None, 5], None),     # 進入不明
])
def test_entry_type(course, expected):
    assert V.entry_type(course) == expected


def test_maeduke_boats_are_inside_their_number():
    assert V.maeduke_boats([1, 4, 5, 6, 2, 3]) == [5, 6]  # 外に押し出された 2〜4号艇は数えない


# ---------------------------------------------------------------- スリットの7形・ST の符号


def test_slit_forms_example_race_is_flat_only():
    f = V.slit_forms([0.18, 0.19, 0.15, 0.19, 0.18, 0.20])
    assert [k for k, v in f.items() if v] == ["flat"]


@pytest.mark.parametrize("st, form", [
    ([0.15, 0.15, 0.16, 0.12, 0.18, 0.18], "kado"),      # min(内3)−4コース = 3
    ([0.20, 0.15, 0.16, 0.15, 0.15, 0.15], "d1"),        # 1−2 = 5
    ([0.10, 0.15, 0.10, 0.12, 0.12, 0.12], "d2"),        # 2 − max(1,3) = 5
    ([0.20, 0.10, 0.17, 0.12, 0.12, 0.12], "d3"),        # 3 − max(2,4) = 5
    ([0.20, 0.20, 0.20, 0.15, 0.15, 0.15], "dash"),      # 内3の和 − 外3の和 = 15
    ([0.15, 0.16, 0.17, 0.25, 0.25, 0.25], "wall"),      # 内3の max−min = 2
])
def test_slit_forms_boundaries(st, form):
    assert V.slit_forms(st)[form]


def test_slit_forms_boundary_minus_one_is_false():
    assert not V.slit_forms([0.15, 0.15, 0.16, 0.13, 0.18, 0.18])["kado"]   # 差2
    assert not V.slit_forms([0.15, 0.16, 0.18, 0.25, 0.25, 0.25])["wall"]   # 差3


def test_slit_forms_dent_needs_both_neighbours():
    # 凹みは両隣より0.05秒以上遅い（2026-10-06 ユーザー決定、BOA-777）。早い方の隣より遅いだけでは当てはまらない
    assert not V.slit_forms([0.20, 0.10, 0.15, 0.12, 0.12, 0.12])["d3"]   # 3−2=5 だが 3−4=3
    assert not V.slit_forms([0.07, 0.01, -0.09, 0.12, 0.12, 0.12])["d2"]  # 例のレースの展示: 2−3=10 だが 2−1=−6
    assert V.slit_forms([0.07, 0.12, 0.05, 0.12, 0.12, 0.12])["d2"]       # 2−max(1,3)=5


def test_slit_forms_round_half_like_mock():
    # round(ST×100) の整数で比べる。0.145×100 は浮動小数で 14.4999… になるので、6桁で丸めてから
    # 四捨五入（JS の Math.round と同じく .5 は上へ。負は −0.155 → −15）
    assert V.st_cent(np.array([0.155, 0.145, 0.06, -0.155])).tolist() == [16, 15, 6, -15]


def test_signed_st_flying_is_negative_regardless_of_source():
    st = np.array([0.03, -0.02, 0.10])
    flying = np.array([True, True, False])
    assert V.signed_st(st, flying).tolist() == [-0.03, -0.02, 0.10]


# ---------------------------------------------------------------- 手がかりの8条件


def test_hint_conditions_example_course_filled():
    # t1-4-hint-threshold.json example.Cfill（このコースの平均ST、5走未満は全体で埋める）
    c = V.hint_conditions([0.150, 0.150, 0.133, 0.127, 0.142, 0.176])
    assert c == {"kado4": True, "kado4_02": False, "in_slow02": False, "in_fastest": False,
                 "d2_slow01": False, "d3_slow01": False, "dash03": False, "flat03": False}


def test_hint_conditions_example_overall():
    # slitpred2_hint.json example.A_conds（全体の平均ST）
    c = V.hint_conditions([0.15, 0.1153, 0.13, 0.1087, 0.1183, 0.1787])
    assert c == {"kado4": True, "kado4_02": False, "in_slow02": True, "in_fastest": False,
                 "d2_slow01": False, "d3_slow01": True, "dash03": False, "flat03": False}


def test_hint_conditions_boundaries_in_1000ths():
    assert V.hint_conditions([0.150, 0.130, 0.15, 0.15, 0.15, 0.15])["in_slow02"]       # 20
    assert not V.hint_conditions([0.150, 0.131, 0.15, 0.15, 0.15, 0.15])["in_slow02"]   # 19
    assert V.hint_conditions([0.12, 0.15, 0.14, 0.14, 0.14, 0.14])["d2_slow01"]          # 150−max(120,140)=10
    assert not V.hint_conditions([0.12, 0.15, 0.141, 0.14, 0.14, 0.14])["d2_slow01"]     # 9
    assert V.hint_conditions([0.12, 0.15, 0.14, 0.14, 0.14, 0.14])["flat03"]             # max−min=30


def test_course_avg_st_fill():
    c = V.fill_course_st(course_st=[0.15, None, 0.13, 0.12, 0.14, 0.17], course_n=[30, 3, 30, 4, 5, 29],
                         overall_st=[0.16, 0.11, 0.14, 0.10, 0.12, 0.18])
    assert c == pytest.approx([0.15, 0.11, 0.13, 0.10, 0.14, 0.17])


# ---------------------------------------------------------------- 攻める艇


@pytest.mark.parametrize("form, boat", [("kado", 4), ("d3", 4), ("dash", 4), ("d2", 3), ("d1", 2),
                                        ("flat", None), ("wall", None)])
def test_attack_boat(form, boat):
    assert V.ATTACK_BOAT.get(form) == boat


def test_attack_boat_went_ahead():
    # 攻める艇 a が、a−1号艇より round(ST×100) で 5 以上早い
    assert V.went_ahead([0.15, 0.15, 0.17, 0.12, 0.15, 0.15], 4)
    assert not V.went_ahead([0.15, 0.15, 0.16, 0.12, 0.15, 0.15], 4)


# ---------------------------------------------------------------- 序盤の注記


@pytest.mark.parametrize("runs, note", [([6, 6, 7, 7, 6, 6], False), ([2, 3, 3, 3, 3, 3], True),
                                        ([0, 0, 0, 0, 0, 0], False), ([0, 1, 4, 4, 4, 4], True)])
def test_early_series_note(runs, note):
    assert V.early_series_note(runs) is note


def test_exh_form_st_flying():
    # Q-F6: F.01〜.05 は .00、F.06 以上の艇がいる行は全部 NaN。欠けはそのまま
    got = V.exh_form_st([[-0.05, 0.10, 0.12, 0.12, 0.12, 0.12],
                         [-0.06, 0.10, 0.12, 0.12, 0.12, 0.12],
                         [0.10, None, 0.12, 0.12, 0.12, 0.12]])
    assert got[0].tolist() == [0.0, 0.10, 0.12, 0.12, 0.12, 0.12]
    assert np.isnan(got[1]).all()
    assert np.isnan(got[2][1]) and got[2][0] == 0.10



def test_scope_boat_reads_the_boat_from_each_key_form():
    """艇ごとの範囲（BOA-806）の艇番は、scope_keys の VC・NC・NCR の形から取る"""
    import v16_defs as V
    keys = V.scope_keys(20, ["A1", "A2", "A2", "B1", "A2", "B1"], 4, "yusho", "G1")
    assert {k: V.scope_boat(v) for k, v in keys.items()} == {
        "VC": 4, "NC": 4, "NCR": 4, "VA": None, "VG": None, "NA": None}
    assert keys["VC"] == "VC:20:1-3-2-0:4B1"
