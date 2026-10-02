"""寄与度プロファイルの集計（tasks T2-3・T2-5）"""

import numpy as np
import pandas as pd
import pytest

import profiles as P

THEMES = [
    {"key": "a", "groups": [{"key": "a1", "label": "A1", "features": ["f1"]},
                            {"key": "a2", "label": "A2", "features": ["f2"]}]},
    {"key": "b", "groups": [{"key": "b1", "label": "B1", "features": ["f3"]}]},
]
FEATS = ["f1", "f2", "f3"]


def frame(n_races=2, venue=(1, 2), grade=("G1", None), rnd=("yosen", "yusho")):
    rows = []
    for r in range(n_races):
        for b in range(1, 7):
            rows.append({"race_id": r, "boat_number": b, "venue_code": venue[r],
                         "grade": grade[r], "round": rnd[r],
                         "race_date": pd.Timestamp("2026-01-01") + pd.Timedelta(days=r)})
    keys = pd.DataFrame(rows)
    rng = np.random.default_rng(0)
    contrib = rng.normal(size=(len(keys), len(FEATS) + 1))  # 最後の列は期待値（pred_contrib の形）
    return keys, contrib


def test_shares_sum_to_one_and_use_abs():
    keys, contrib = frame()
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    for r in rows:
        assert sum(r["shares"].values()) == pytest.approx(1.0)
        assert set(r["shares"]) == {"a", "b"}
    allrow = next(r for r in rows if (r["venue_code"], r["grade"], r["round"], r["boat_number"])
                  == (0, "all", "all", 0))
    m = np.abs(contrib[:, :3]).mean(axis=0)
    assert allrow["shares"]["b"] == pytest.approx(m[2] / m.sum())


def test_breakdown_groups_add_up_to_theme_share():
    keys, contrib = frame()
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    for r in rows:
        a = sum(g["share"] for g in r["breakdown"]["a"])
        assert a == pytest.approx(r["shares"]["a"])
        assert [g["key"] for g in r["breakdown"]["a"]] == ["a1", "a2"]


def test_slices_counts_and_unknown_grade_only_in_all():
    keys, contrib = frame()
    rows = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=2)
    idx = {(r["venue_code"], r["grade"], r["round"], r["boat_number"]): r for r in rows}
    allrow = idx[(0, "all", "all", 0)]
    assert (allrow["n_races"], allrow["n_boats"]) == (2, 12)
    assert idx[(0, "all", "all", 3)]["n_boats"] == 2
    assert idx[(0, "G1", "all", 0)]["n_races"] == 1
    # グレード不明のレース（2本目）は「全グレード」にだけ入る
    assert not any(k[1] not in ("all", "G1") for k in idx)
    assert idx[(2, "all", "yusho", 0)]["n_races"] == 1
    assert (2, "G1", "all", 0) not in idx  # n=0 のセルは書かない
    assert all(r["finish_target"] == 2 for r in rows)
    # 全組み合わせ: 会場(全/実)×グレード(全/実)×ラウンド(全/実)×艇番(全/実)
    assert allrow["period_from"] == "2026-01-01" and allrow["period_to"] == "2026-01-02"


def test_share_sd_across_seeds():
    keys, contrib = frame()
    other = contrib.copy()
    other[:, 2] *= 3
    rows = P.slice_profiles(keys, [contrib, other], FEATS, THEMES, finish_target=1)
    r = next(r for r in rows if (r["venue_code"], r["grade"], r["round"], r["boat_number"])
             == (0, "all", "all", 0))
    assert r["share_sd"]["b"] > 0
    assert r["share_sd"]["a"] == pytest.approx(r["share_sd"]["b"])  # 2テーマなので同じ大きさで逆に動く
    single = P.slice_profiles(keys, [contrib], FEATS, THEMES, finish_target=1)
    assert single[0]["share_sd"] is None


def test_feature_missing_from_model_is_an_error():
    keys, contrib = frame()
    with pytest.raises(ValueError, match="f9"):
        P.slice_profiles(keys, [contrib], FEATS,
                         THEMES + [{"key": "c", "groups": [{"key": "c1", "label": "C", "features": ["f9"]}]}],
                         finish_target=1)
