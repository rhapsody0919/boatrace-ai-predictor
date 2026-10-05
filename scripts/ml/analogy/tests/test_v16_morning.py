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
