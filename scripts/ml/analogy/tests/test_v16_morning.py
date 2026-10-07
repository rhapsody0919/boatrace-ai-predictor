"""v16 朝のバッチの組み立て（tasks T2-5）"""
import numpy as np
import pandas as pd
import pytest

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


def test_top3_boats_keeps_tied_boats():
    """長期の同着（着 6,4,2,1,2,5）: 2着の3号艇・5号艇の両方を入れ、3着は 5号艇になる（データ精度の検証で見つかった）"""
    import v16_morning as M
    fr = np.array([[6, 4, 2, 1, 2, 5], [1, 2, 3, np.nan, 4, 5], [np.nan] * 6])
    assert M.top3_boats(fr).tolist() == [[4, 3, 5], [1, 2, 3], [0, 0, 0]]


def test_upload_dir_sends_every_file_once_in_parallel(tmp_path, monkeypatch):
    import threading

    for k in ("facts", "similar"):
        (tmp_path / k).mkdir()
        for i in range(20):
            (tmp_path / k / f"{i}.json.gz").write_bytes(b"x")
    sent, lock = [], threading.Lock()

    def fake(method, path, body=None, headers=None):
        assert method == "POST" and headers["x-upsert"] == "false"
        with lock:
            sent.append(path)
        return 200, b""

    monkeypatch.setattr(M, "_storage", fake)
    assert M.upload_dir(tmp_path, "2026-10-06/r1", workers=4) == 40
    assert sorted(sent) == sorted({f"object/analogy-v16/2026-10-06/r1/{k}/{i}.json.gz"
                                    for k in ("facts", "similar") for i in range(20)})


def test_upload_dir_raises_when_one_fails(tmp_path, monkeypatch):
    import pytest

    (tmp_path / "a.json.gz").write_bytes(b"x")
    (tmp_path / "b.json.gz").write_bytes(b"x")

    def fake(method, path, body=None, headers=None):
        if path.endswith("b.json.gz"):
            raise RuntimeError("HTTP 409")
        return 200, b""

    monkeypatch.setattr(M, "_storage", fake)
    with pytest.raises(RuntimeError, match="409"):
        M.upload_dir(tmp_path, "p", workers=2)


def test_late_for():
    from datetime import datetime, timedelta
    now = datetime(2026, 10, 6, 9, 49, tzinfo=M.JST)
    assert M.late_for(now - timedelta(minutes=1), now)
    assert not M.late_for(now + timedelta(minutes=1), now)
    assert not M.late_for(None, now)


def test_pool_exhibition_counts_and_hundredths():
    """展示後の段が展示で決まる5項目の pool_rate を数えるための母集団の値: 天候・風・波は値の組ごとの件数、
    展示タイムは 1/100秒の整数。今日のレース（pool の外）は含めない"""
    races = pd.DataFrame({"weather_code": [1, 1, 2, 1], "wind_x": [0.5, 0.5, 1.0, 0.5], "wind_y": [0.0, 0.0, 1.0, 0.0],
                          "wind_speed": [2, 2, 3, 2], "wave_height": [1, 1, 3, 1]})
    exh = np.array([[6.78, 6.8, np.nan, 6.75, 6.7, 6.81]] * 4, dtype=np.float32)
    pool = np.array([True, True, True, False])
    p = M.pool_exhibition(races, exh, pool)
    assert p["n"] == 3 and p["race_cols"] == list(M.EXH_RACE_COLS)
    assert sorted(p["race_rows"]) == [[1.0, 0.5, 0.0, 2.0, 1.0, 2], [2.0, 1.0, 1.0, 3.0, 3.0, 1]]
    assert p["exh_time"][:6] == [678, 680, None, 675, 670, 681] and len(p["exh_time"]) == 18


def test_pool_exhibition_rejects_non_hundredths():
    races = pd.DataFrame({k: [0.0] for k in M.EXH_RACE_COLS})
    with pytest.raises(ValueError):
        M.pool_exhibition(races, np.array([[6.785, 6.8, 6.7, 6.7, 6.7, 6.7]], dtype=np.float32), np.array([True]))
