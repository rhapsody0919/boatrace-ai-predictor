"""v16 展開シナリオ（タブ3）の範囲ごとの集計 scenario（tasks T2-3）"""
import numpy as np
import pandas as pd
import pytest

import v16_scenario as SC

WAKU = [1, 2, 3, 4, 5, 6]


def races(rows):
    """(course_by_boat, st_by_course, ranks, technique, payout)"""
    return pd.DataFrame({
        "race_id": [f"2026-09-0{i + 1}-20-12" for i in range(len(rows))],
        "race_date": [f"2026-09-0{i + 1}" for i in range(len(rows))], "venue_code": 20,
        "course_by_boat": [r[0] for r in rows], "st_by_course": [r[1] for r in rows],
        "rank1": [r[2][0] for r in rows], "rank2": [r[2][1] for r in rows], "rank3": [r[2][2] for r in rows],
        "winning_technique": [r[3] for r in rows], "payout_3tan": [r[4] for r in rows],
    })


@pytest.mark.parametrize("course, types", [
    (WAKU, {"all", "waku"}),
    ([2, 1, 3, 4, 5, 6], {"all", "inlost"}),
    ([1, 3, 4, 5, 6, 2], {"all", "mae", "mae6"}),
    ([1, 4, 5, 6, 2, 3], {"all", "mae", "mae56"}),
    ([1, 2, 4, 3, 5, 6], {"all", "mae", "maeOther"}),
    ([1, 2, 3, 6, 4, 5], {"all", "mae", "mae56"}),  # 4号艇は押し出されただけ（前付けに数えない）
])
def test_entry_types(course, types):
    e = SC.entry_types(np.array([course], dtype=float))
    assert {k for k, v in e.items() if v[0]} == types


def test_scope_cells_counts_and_rows():
    flat = [0.15, 0.16, 0.15, 0.17, 0.16, 0.15]
    kado = [0.15, 0.15, 0.16, 0.12, 0.18, 0.18]
    d = SC.prepare(races([
        (WAKU, flat, (1, 2, 3), "逃げ", 1230),
        (WAKU, kado, (4, 1, 5), "まくり", 15600),
        ([1, 3, 4, 5, 6, 2], flat, (1, 6, 2), None, None),
    ]))
    out = SC.scope_cells(np.array([True, True, True]), d)
    assert out["n"] == 3
    any_ = out["cells"]["all"]["forms"]["any"]
    assert any_["n"] == 3 and any_["first_boat"] == [2, 0, 0, 1, 0, 0]
    assert any_["technique"]["その他"] == 1 and any_["technique"]["まくり"] == 1
    assert any_["payout_known"] == 2 and any_["manshu"] == 1
    assert any_["b1_win"] == 2
    assert any_["tri"] == {"1-2-3": 1, "1-6-2": 1, "4-1-5": 1}
    assert any_["win_tech"]["4"]["まくり"] == 1
    assert [r["finish_1_2_3"] for r in any_["races"]] == ["1-2-3", "4-1-5", "1-6-2"]
    assert out["cells"]["waku"]["forms"]["kado"]["n"] == 1
    assert out["cells"]["mae6"]["forms"]["flat"]["n"] == 1
    assert out["cells"]["waku"]["forms"]["kado"]["races"][0]["forms"] == ["flat", "wall", "kado"]  # 形は重なる


def test_scope_cells_no_rows_when_30_or_more():
    d = SC.prepare(races([(WAKU, [0.15] * 6, (1, 2, 3), "逃げ", 500)] * 30))
    assert "races" not in SC.scope_cells(np.ones(30, bool), d)["cells"]["all"]["forms"]["any"]


def test_scope_hints_counts_waku_only():
    kado = [0.15, 0.15, 0.16, 0.12, 0.18, 0.18]
    flat = [0.15, 0.16, 0.15, 0.17, 0.16, 0.15]
    d = SC.prepare(races([(WAKU, kado, (4, 1, 2), "まくり", 900), (WAKU, flat, (1, 2, 3), "逃げ", 300),
                          ([2, 1, 3, 4, 5, 6], kado, (4, 1, 2), "まくり", 900)]))
    avg = np.array([[0.150, 0.150, 0.133, 0.127, 0.142, 0.176],   # kado4 あり
                    [0.150, 0.150, 0.150, 0.160, 0.150, 0.150],   # kado4 なし
                    [0.150, 0.150, 0.133, 0.127, 0.142, 0.176]])  # 枠なりでないので数えない
    out = SC.scope_hints(np.ones(3, bool), d, {"course": avg})
    assert out["course"]["kado4"]["kado"] == {"hit": [1, 1], "miss": [0, 1]}
    assert out["course"]["kado4"]["any"] == {"hit": [1, 1], "miss": [1, 1]}


def test_hint_matrix_matches_scalar_definition():
    import v16_defs as V
    rng = np.random.default_rng(0)
    a = np.round(rng.uniform(0.08, 0.25, size=(200, 6)), 3)
    m = SC.hint_matrix(a)
    for i in range(len(a)):
        assert {k: bool(v[i]) for k, v in m.items()} == V.hint_conditions(a[i])
