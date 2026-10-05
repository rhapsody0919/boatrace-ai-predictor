"""v16 朝のバッチの組み立て（tasks T2-5）"""
import numpy as np
import pandas as pd

import v16_morning as M


def test_scope_masks():
    races = pd.DataFrame({"venue_code": [20, 20, 5, 20], "grade": ["G1", "ippan", "SG", "SG"],
                          "round": ["yusho", "yusho", "yusho", "yosen"]})
    cls = np.array([["A1"] * 6, ["A1"] * 6, ["A1"] * 6, ["B1"] + ["A1"] * 5])
    combos = np.array(["6-0-0-0", "6-0-0-0", "6-0-0-0", "5-0-1-0"], dtype=object)
    m = lambda k: M.scope_masks(k, races, cls, combos).tolist()  # noqa: E731
    assert m("VC:20:6-0-0-0:1A1") == [True, True, False, False]
    assert m("NC:6-0-0-0:1A1") == [True, True, True, False]
    assert m("NCR:6-0-0-0:1A1:yusho") == [True, True, True, False]
    assert m("VA:20") == [True, True, False, True]
    assert m("VG:20") == [True, False, False, True]
    assert m("NA") == [True] * 4
    assert m("NC:5-0-1-0:1B1") == [False, False, False, True]


def test_attach_series_with_string_race_ids():
    series = pd.DataFrame({"race_id": pd.Series(["2026-09-27-20-12", "2026-09-27-20-12"], dtype="str"),
                           "boat_number": [1, 3], "value": [8.5, np.nan], "n_prior": [6, 0]})
    arr = {}
    M.attach_series(arr, pd.DataFrame({"race_id": [202609272012]}), series)
    assert arr["series_score"][0, 0] == 8.5 and np.isnan(arr["series_score"][0, 2])
    assert arr["series_runs"][0].tolist() == [6, 0, 0, 0, 0, 0]


def test_select_targets():
    from datetime import datetime, timedelta
    now = datetime(2026, 10, 5, 7, 10, tzinfo=M.JST)
    row = lambda rid, mins, **kw: {"race_id": rid, "deadline": now + timedelta(minutes=mins),  # noqa: E731
                                   "cancelled": False, "absent": False, "snapshot_hash": None} | kw
    rows = [row("a", 60), row("b", 9), row("c", 10), row("d", 60, cancelled=True), row("e", 60, absent=True),
            row("f", 60, snapshot_hash="h1"), row("g", 60, snapshot_hash="old"), row("h", 60),
            row("i", 60) | {"deadline": None}]
    hashes = {k: "h1" for k in "abcdefgi"}  # h は6艇の出走表がそろっていない
    assert M.select_targets(rows, now, hashes) == ["a", "c", "g"]


def test_example_fixture_matches_known_values():
    """例のレースの固定データ（tasks T1-6）が、分析で確かめた値（t1-2・slitpred2_hint・knn7）と食い違っていない"""
    import json
    from pathlib import Path

    d = json.loads((Path(__file__).resolve().parents[1] / "testdata/v16-example.json").read_text())
    t = d["today"]
    assert [round(v, 4) for v in t["items"]["series_score"]["values"]] == [8.6667, 8.3333, 8.0, 7.7143, 7.3333, 6.6667]
    assert t["series_runs_before_today"] == [6, 6, 7, 7, 6, 6]
    assert t["course_st"]["course"] == [0.15, 0.1503, 0.1333, 0.1267, 0.142, 0.1755]
    assert t["hints"]["course"]["kado4"] and not t["hints"]["course"]["in_slow02"]
    assert d["similar"]["n_layer"] == 15 and d["similar"]["neighbors"][0]["race_id"] == "2021-10-14-16-12"
    assert d["facts"]["VC:20:6-0-0-0:1A1"]["n"] == 1134 and d["facts"]["NC:6-0-0-0:1A1"]["n"] == 25290
    assert d["scenario"]["VC:20:6-0-0-0:1A1"]["n"] == 1117 and d["scenario"]["NC:6-0-0-0:1A1"]["n"] == 24871
