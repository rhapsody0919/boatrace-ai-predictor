"""BOA-822 イン崩れ注意度の夜の集計（in_caution_bands.py）の検証。DB には繋がない。"""

import json
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import db
import features as F
import in_caution_bands as I

CFG = I.load_config()
CASES = json.loads((Path(__file__).parent / "fixtures" / "in_caution_cases.json").read_text())["gapCases"]


def labelled(rates_by_race, round_="yosen", winner=1):
    """艇の行（add_labels の後の形）。nat_win は read() と同じ float32"""
    rows = []
    for rid, rates in rates_by_race.items():
        for b, r in enumerate(rates, start=1):
            rows.append({"race_id": rid, "race_date": pd.Timestamp("2026-10-05"), "boat_number": b,
                         "nat_win": np.float32(np.nan if r is None else r), "round": round_,
                         "race_ok": True, "y_win": int(b == winner)})
    return pd.DataFrame(rows)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_gap_and_band_match_shared_cases(case):
    out = I.boat1_rows(labelled({1: case["rates"]}), CFG)
    if case["band"] is None:
        assert out.empty
    else:
        assert out.loc[0, "gap_cents"] == case["gapCents"]
        assert out.loc[0, "gap_band"] == case["band"]


def test_round_groups_semifinal_final_and_rest():
    s = pd.Series(["yosen", "junyu", "yusho", "other", None])
    assert I.round_grp(s).tolist() == ["other", "junyu", "yusho", "other", "other"]


def test_count_bands_by_day_round_band_and_source():
    rows = pd.DataFrame({
        "race_date": [date(2025, 12, 2), date(2025, 12, 2), date(2025, 12, 3), date(2025, 12, 3)],
        "round_grp": ["other", "other", "other", "junyu"],
        "gap_band": [-5, -5, -5, -5],
        "non_win": [1, 0, 1, 1],
    })
    c = I.count_bands(rows)
    assert c[["race_date", "round_grp", "gap_band", "n", "non_win", "source"]].values.tolist() == [
        [date(2025, 12, 2), "other", -5, 2, 1, "kb"],
        [date(2025, 12, 3), "junyu", -5, 1, 1, "main"],
        [date(2025, 12, 3), "other", -5, 1, 1, "main"],
    ]


def test_window_is_14_days_until_previous_day_or_full_from_config():
    assert I.window(date(2026, 10, 13), False, CFG) == (date(2026, 9, 29), date(2026, 10, 12))
    assert I.window(date(2026, 10, 13), True, CFG) == (date(2019, 4, 1), date(2026, 10, 12))


@pytest.mark.parametrize("jst,quiet", [("02:30", False), ("04:29", False), ("04:30", True),
                                        ("12:00", True), ("22:59", True), ("23:00", False)])
def test_quiet_hours_jst(jst, quiet):
    now = datetime.fromisoformat(f"2026-10-13T{jst}:00+09:00").astimezone(timezone.utc)
    assert I.in_quiet_hours(now) is quiet


# ---------------------------------------------------------------- 本体の CSV から（load_main → add_labels）
RID = "2026-10-05-02-{:02d}"


def write_main_csvs(d: Path, races: list[dict]):
    """races: {no, rates, stage, ranks, absent(艇番), flying(艇番), cancelled}"""
    rr, en, ex, co, re, st = [], [], [], [], [], []
    for r in races:
        rid = RID.format(r["no"])
        rr.append({"race_id": rid, "race_date": "2026-10-05", "venue_code": 2, "race_number": r["no"],
                   "race_grade": "ippan", "cancellation_status": ""})
        co.append({"race_id": rid, "weather": "晴", "wind_direction": "北", "wind_speed": 2, "wave_height": 1,
                   "series_day": 2, "is_final_day": "false", "race_stage": r.get("stage", "予選")})
        ranks = r.get("ranks", [1, 2, 3, 4, 5, 6])
        re.append({"race_id": rid, **{f"rank{k}": b for k, b in enumerate(ranks, start=1)},
                   "is_cancelled": "true" if r.get("cancelled") else "false", "is_no_race": "false",
                   "race_status": "", "refund_boats": "", "winning_technique": "", "payout_trio": 1000,
                   **{f"actual_course_{k}": k for k in range(1, 7)}})
        for b, rate in enumerate(r["rates"], start=1):
            en.append({"race_id": rid, "boat_number": b, "racer_id": 4000 + b, "grade": "B1", "age": 30,
                       "win_rate": "" if rate is None else rate, "global_2rate": 30, "local_win_rate": 5,
                       "local_2rate": 30, "motor_2rate": 30, "boat_2rate": 30, "weight_kg": 52,
                       "branch": "東京", "is_absent": "true" if b == r.get("absent") else "false"})
            ex.append({"race_id": rid, "boat_number": b, "exhibition_time": 6.8, "exhibition_course": b,
                       "start_timing": 0.1, "start_flag": "", "is_absent": "false"})
            st.append({"race_id": rid, "boat_number": b, "start_timing": 0.15,
                       "is_flying": "true" if b == r.get("flying") else "false", "is_late_start": "false",
                       "finish_mark": ""})
    for name, rows in (("races", rr), ("entries", en), ("exhibition", ex), ("conditions", co),
                       ("results", re), ("start_timings", st)):
        pd.DataFrame(rows).to_csv(d / f"{name}.csv", index=False)


def test_main_csvs_complete_races_only(tmp_path):
    five = [5.0] * 5
    write_main_csvs(tmp_path, [
        {"no": 1, "rates": [4.81, 5.12, 6.93, 3.2, 4.0, 5.5], "ranks": [2, 1, 3, 4, 5, 6]},  # 非1着・帯 -5
        {"no": 2, "rates": [7.0, *five], "stage": "準優勝戦"},                                 # 1着・帯 4・準優
        {"no": 3, "rates": [7.0, *five], "absent": 4},                                         # 欠場 → 数えない
        {"no": 4, "rates": [0.0, *five]},                                                      # 0.00 は勝率 → 帯 -8
        {"no": 5, "rates": [None, *five]},                                                     # 勝率なし → 数えない
        {"no": 6, "rates": [7.0, *five], "ranks": [2, 3, 4, 5, 6, 1], "flying": 1},           # 1号艇 F → 非1着
        {"no": 7, "rates": [6.0, None, *[5.0] * 4], "stage": "優勝戦"},                         # 帯 2・優勝戦
        {"no": 8, "rates": [7.0, *five], "cancelled": True},                                   # 中止 → 数えない
    ])
    out = I.boat1_rows(I.load(False, tmp_path), CFG).set_index("race_id")
    got = {F.int_to_rid(rid)[-2:]: (r.round_grp, int(r.gap_band), int(r.non_win)) for rid, r in out.iterrows()}
    assert got == {
        "01": ("other", -5, 1),
        "02": ("junyu", 4, 0),
        "04": ("other", -8, 0),
        "06": ("other", 4, 1),
        "07": ("yusho", 2, 0),
    }


# ---------------------------------------------------------------- 書き込み（db.request の偽物）
class FakeDb:
    def __init__(self, in_table=None):
        self.calls = []
        self.in_table = in_table

    def __call__(self, method, path, body=None, prefer=None):
        self.calls.append((method, path, body, prefer))
        if method == "HEAD":
            n = self.in_table if self.in_table is not None else sum(
                len(b) for m, _, b, _ in self.calls if m == "POST")
            return None, {"Content-Range": f"*/{n}"}
        return None, {}


def counts_of(k):
    return pd.DataFrame({"race_date": [date(2026, 10, 1)] * k, "round_grp": ["other"] * k,
                         "gap_band": list(range(k)), "n": [3] * k, "non_win": [1] * k,
                         "source": ["main"] * k})


def test_write_upserts_then_deletes_stale_rows_in_window():
    fake = FakeDb()
    stamp = "2026-10-12T17:30:00.123456+00:00"
    r = I.write_table(counts_of(3), date(2026, 9, 29), date(2026, 10, 12), stamp, request=fake)
    post, delete, head = fake.calls
    assert post[0] == "POST" and post[1] == "in_caution_gap_band_daily?on_conflict=race_date,round_grp,gap_band"
    assert "resolution=merge-duplicates" in post[3]
    assert all(row["computed_at"] == stamp for row in post[2])
    # 件数0になったセル（今回書かなかった行）を消す。窓の外は消さない
    assert delete[0] == "DELETE" and delete[1] == (
        "in_caution_gap_band_daily?race_date=gte.2026-09-29&race_date=lte.2026-10-12"
        f"&computed_at=lt.{db.q(stamp)}")
    assert head[0] == "HEAD"
    assert r == {"rows": 3, "n": 9, "non_win": 3}


def test_write_splits_into_batches_of_1000():
    fake = FakeDb()
    I.write_table(counts_of(2500), date(2026, 9, 29), date(2026, 10, 12), "t", request=fake)
    assert [len(b) for m, _, b, _ in fake.calls if m == "POST"] == [1000, 1000, 500]


def test_write_fails_on_zero_rows_and_on_count_mismatch():
    with pytest.raises(db.PostgrestError, match="0件"):
        I.write_table(counts_of(0), date(2026, 9, 29), date(2026, 10, 12), "t", request=FakeDb())
    with pytest.raises(db.PostgrestError, match="行数が合わない"):
        I.write_table(counts_of(3), date(2026, 9, 29), date(2026, 10, 12), "t", request=FakeDb(in_table=4))


def test_main_refuses_to_write_in_quiet_hours(monkeypatch):
    monkeypatch.setattr(I, "in_quiet_hours", lambda now: True)
    monkeypatch.setattr(I, "load", lambda full: pytest.fail("時間外は読み込まない"))
    with pytest.raises(SystemExit, match="--force"):
        I.main([])
