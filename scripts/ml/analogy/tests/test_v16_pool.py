"""v16 の過去レースの行（BOA-635 の値の約束 D-1〜D-5・展開シナリオの母集団。tasks T1-0a・T1-0b）"""
import json
import os
from pathlib import Path

import pandas as pd
import pytest

import v16_pool as P

COURSE_SWAP_45 = [1, 2, 3, 5, 4, 6]  # 4号艇が5コース、5号艇が4コース


def write(d: Path, name: str, rows: list[dict]):
    pd.DataFrame(rows).to_csv(d / f"{name}.csv", index=False)


def kb_boat(race_id, boat, course, st, finish_raw, rank, flying=False, late=False, cls="A1"):
    return {"race_id": race_id, "boat_number": boat, "racer_id": 4000 + boat, "class": cls, "course": course, "start_timing": st,
            "is_flying": flying, "is_late_start": late, "finish_raw": finish_raw, "finish_rank": rank}


def main_boat(race_id, boat, st, mark, flying=False, late=False, absent=False, grade="A1"):
    return ({"race_id": race_id, "boat_number": boat, "racer_id": 4000 + boat, "grade": grade,
             "is_absent": absent},
            {"race_id": race_id, "boat_number": boat, "is_absent": absent},
            {"race_id": race_id, "boat_number": boat, "start_timing": st, "is_flying": flying,
             "is_late_start": late, "finish_mark": mark})


def main_result(race_id, ranks, courses, payout, technique="逃げ", status="normal", refund=None, no_race=False):
    r = {"race_id": race_id, "is_cancelled": False, "is_no_race": no_race, "race_status": status,
         "refund_boats": json.dumps(refund) if refund is not None else None,
         "winning_technique": technique, "payout_trio": payout}
    r.update({f"rank{k}": (ranks[k - 1] if k <= len(ranks) else None) for k in range(1, 7)})
    r.update({f"actual_course_{i}": courses[i - 1] for i in range(1, 7)})
    return r


def row(src, race_id):
    return P.layer_row(src.loc[race_id].copy().rename(None).to_dict() | {"race_id": race_id})


@pytest.fixture
def src(tmp_path):
    # ---- 長期
    kb_races = [
        # K1: 6号艇が F（着外）。layer には入る・展開シナリオの母集団には入らない
        {"race_id": "2025-11-01-20-12", "race_date": "2025-11-01", "venue_code": 20, "race_number": 1, "has_result": True,
         "technique": "まくり", "payout_3tan": 12340},
        # K2: 返還なし・6艇とも進入あり
        {"race_id": "2025-11-02-20-01", "race_date": "2025-11-02", "venue_code": 20, "race_number": 1, "has_result": True,
         "technique": "逃げ", "payout_3tan": 450},
        # K3: 3号艇が出走前の欠場（K0）・決まり手が6分類の外
        {"race_id": "2025-11-02-20-02", "race_date": "2025-11-02", "venue_code": 20, "race_number": 1, "has_result": True,
         "technique": "不明", "payout_3tan": None},
        # K5: 2号艇と5号艇が1着同着（長期は着を 1,1,3 と付ける）
        {"race_id": "2025-11-02-20-04", "race_date": "2025-11-02", "venue_code": 20, "race_number": 1, "has_result": True,
         "technique": "差し", "payout_3tan": 3210},
        # K4: 結果なし（入れない）
        {"race_id": "2025-11-02-20-03", "race_date": "2025-11-02", "venue_code": 20, "race_number": 1, "has_result": False,
         "technique": None, "payout_3tan": None},
    ]
    kb_boats = []
    for b, c in zip(range(1, 7), COURSE_SWAP_45):
        f = b == 6
        kb_boats.append(kb_boat("2025-11-01-20-12", b, c, -0.01 if f else 0.10 + b / 100,
                                "F" if f else str(b), None if f else b, flying=f))
        kb_boats.append(kb_boat("2025-11-02-20-01", b, b, 0.15, str(b), b, cls="A1" if b < 6 else "A2"))
        k = b == 3
        kb_boats.append(kb_boat("2025-11-02-20-02", b, None if k else b, None if k else 0.2,
                                "K0" if k else str(b if b < 3 else b - 1), None if k else (b if b < 3 else b - 1)))
        kb_boats.append(kb_boat("2025-11-02-20-03", b, b, 0.2, None, None))
        dh = {1: 3, 2: 1, 3: 4, 4: 5, 5: 1, 6: 6}[b]
        kb_boats.append(kb_boat("2025-11-02-20-04", b, b, 0.15, f"0{dh}", dh))
    write(src_dir := tmp_path, "kb_races", kb_races)
    write(src_dir, "kb_boats", kb_boats)

    # ---- 本体
    races = [{"race_id": r, "race_date": r[:10], "venue_code": int(r[11:13]), "race_number": int(r[14:]),
              "cancellation_status": cs}
             for r, cs in [("2026-09-27-20-12", None), ("2026-09-27-20-11", None), ("2026-09-27-20-10", None),
                           ("2026-09-27-20-09", None), ("2026-09-27-20-08", "confirmed")]]
    results = [
        # M1: 返還なし。払戻は payout_trio（3連単）
        main_result("2026-09-27-20-12", [1, 4, 2, 3, 5, 6], COURSE_SWAP_45, 5670),
        # M2: 3号艇が F で、着の並びでは2着（1〜3着に返還艇）→ layer に入れない
        main_result("2026-09-27-20-11", [1, 3, 2, 4, 5, 6], [1, 2, 3, 4, 5, 6], None, status="partial_refund",
                    refund=[3]),
        # M3: 不成立（race_status だけが no_race。is_no_race は false）
        main_result("2026-09-27-20-10", [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], None, status="no_race"),
        # M4: 6号艇が欠（refund_boats だけ・実進入なし）。払戻は null（特払い等）
        main_result("2026-09-27-20-09", [2, 1, 3, 4, 5], [1, 2, 3, 4, 5, None], None, technique="差し",
                    status="partial_refund", refund=[6]),
        # M5: 中止（入れない）
        main_result("2026-09-27-20-08", [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 100),
    ]
    entries, exh, st = [], [], []
    for b in range(1, 7):
        for rid, args in [("2026-09-27-20-12", (0.10 + b / 100, str(b))),
                          ("2026-09-27-20-11", (0.05, "F" if b == 3 else str(b))),
                          ("2026-09-27-20-10", (0.1, str(b))),
                          ("2026-09-27-20-09", (None, "欠") if b == 6 else (0.12, str(b))),
                          ("2026-09-27-20-08", (0.1, str(b)))]:
            e, x, s = main_boat(rid, b, *args, flying=(rid.endswith("-11") and b == 3))
            entries.append(e), exh.append(x), st.append(s)
    write(src_dir, "races", races)
    write(src_dir, "results", results)
    write(src_dir, "entries", entries)
    write(src_dir, "exhibition", exh)
    write(src_dir, "start_timings", st)
    return P.load_races(src_dir).set_index("race_id")


def test_only_races_with_results_and_not_cancelled(src):
    assert sorted(src.index) == ["2025-11-01-20-12", "2025-11-02-20-01", "2025-11-02-20-02",
                                 "2025-11-02-20-04", "2026-09-27-20-09", "2026-09-27-20-11", "2026-09-27-20-12"]


def test_d1_payout_3tan_from_payout_trio_and_kb(src):
    assert src.loc["2026-09-27-20-12", "payout_3tan"] == 5670
    assert src.loc["2025-11-01-20-12", "payout_3tan"] == 12340


def test_d2_st_null_for_flying_late_absent(src):
    r = row(src, "2025-11-01-20-12")
    assert r["st_by_course"][5] is None  # 6号艇（6コース）は F
    assert r["st_by_course"][3] == pytest.approx(0.15)  # 4コースは5号艇
    assert r["st_by_course"][4] == pytest.approx(0.14)  # 5コースは4号艇
    m4 = src.loc["2026-09-27-20-09"]
    assert m4["st_by_course"][5] is None


def test_d3_payout_null_stays_null(src):
    assert pd.isna(src.loc["2026-09-27-20-09", "payout_3tan"])
    assert pd.isna(src.loc["2025-11-02-20-02", "payout_3tan"])


def test_d4_unknown_course_is_null_not_boat_number(src):
    assert src.loc["2026-09-27-20-09", "course_by_boat"] == [1, 2, 3, 4, 5, None]
    assert src.loc["2025-11-02-20-02", "course_by_boat"] == [1, 2, None, 4, 5, 6]
    assert src.loc["2026-09-27-20-12", "course_by_boat"] == COURSE_SWAP_45


def test_d5_layer_excludes_returned_in_top3_and_no_race(src):
    ok = src["layer_ok"]
    assert not ok["2026-09-27-20-11"]
    assert "2026-09-27-20-10" not in src.index
    assert ok[["2025-11-01-20-12", "2025-11-02-20-01", "2025-11-02-20-02", "2026-09-27-20-09",
               "2026-09-27-20-12"]].all()


def test_layer_row_shape(src):
    r = row(src, "2026-09-27-20-12")
    assert r == {"race_id": "2026-09-27-20-12", "race_date": "2026-09-27", "rank1": 1, "rank2": 4, "rank3": 2,
                 "winning_technique": "逃げ", "course_by_boat": COURSE_SWAP_45,
                 "st_by_course": [0.11, 0.12, 0.13, 0.15, 0.14, 0.16], "payout_3tan": 5670}
    k3 = row(src, "2025-11-02-20-02")
    assert k3["winning_technique"] is None
    assert k3["st_by_course"][2] is None


def test_kb_dead_heat_keeps_three_places_in_layer(src):
    r = src.loc["2025-11-02-20-04"]
    assert (r["rank1"], r["rank2"], r["rank3"]) == (2, 5, 1)
    assert r["layer_ok"]
    assert not r["tab3_ok"]  # 1着が2艇（モックの SQL の母集団と同じく除く）


def test_tab3_population_excludes_returned_absent_unknown_course(src):
    assert src["tab3_ok"][lambda s: s].index.tolist() == ["2025-11-02-20-01", "2026-09-27-20-12"]


def test_all_a1(src):
    assert src.loc["2026-09-27-20-12", "all_a1"]
    assert not src.loc["2025-11-02-20-01", "all_a1"]


# ---- 本番の書き出し（ANALOGY_DATA_DIR）があるときだけ: モックの SQL の母集団を再現する（tasks T1-0b）
# 期待値: entry-slit/prep9/prep9b.md・analysis/t1/t1-3-refund.json の版A（2019-04-01〜2026-09-26）
REAL = Path(os.environ.get("ANALOGY_DATA_DIR", "")) if os.environ.get("ANALOGY_DATA_DIR") else None


@pytest.mark.skipif(REAL is None or not (REAL / "results.csv").exists(), reason="本番の書き出しが無い")
def test_tab3_population_matches_mock_sql():
    r = P.load_races(REAL)
    r = r[(r["race_date"] >= "2019-04-01") & (r["race_date"] <= "2026-09-26") & r["tab3_ok"]]
    assert int(r["all_a1"].sum()) == 24871
    assert int((r["all_a1"] & (r["venue_code"] == 20)).sum()) == 1117
