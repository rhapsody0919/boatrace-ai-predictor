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


def test_main_refuses_when_quiet_hours_start_during_load(monkeypatch):
    # 開始時は時間外（書ける）だが、読み込み・集計の後に 04:30 を過ぎた
    calls = iter([False, True])
    monkeypatch.setattr(I, "in_quiet_hours", lambda now: next(calls))
    monkeypatch.setattr(I, "load", lambda full: labelled({1: [4.81, 5.12, 6.93, 3.2, 4.0, 5.5]}))
    monkeypatch.setattr(I, "write_table", lambda *a, **k: pytest.fail("時間内は書かない"))
    with pytest.raises(SystemExit, match="--force"):
        I.main(["--date", "2026-10-06"])


# ---------------------------------------------------------------- /accuracy の実績（plan §6、task 29）
@pytest.mark.parametrize("non_win,n,pct,level", [
    (22797, 35181, 65, "high"),   # 例のレース 2026-10-11 戸田4R（64.8% → 65）
    (101, 200, 51, "mid"),        # 50.5% は四捨五入で 51（JS の pctOf と同じ）
    (69, 200, 35, "mid"),         # 34.5% → 35 は中くらい（35 未満が堅め）
    (68, 200, 34, "low"),
    (109, 200, 55, "high"),       # 54.5% → 55 は崩れやすい
    (108, 200, 54, "mid"),
])
def test_pct_and_level_match_js(non_win, n, pct, level):
    assert I.pct_of(non_win, n) == pct
    assert I.level_of(pct, CFG) == level


def acc_counts(rows):
    return pd.DataFrame(rows, columns=["race_date", "round_grp", "gap_band", "n", "non_win"])


def test_prelaunch_levels_each_day_by_rates_before_that_day():
    cfg = {**CFG, "prelaunch": {"from": "2025-06-01", "to": "2025-06-02"}, "minCellN": 100}
    counts = acc_counts([
        # 期間より前: 帯 −5 は 36%（中くらい）、帯 −8 は 50件だけ（件数が少なく段を出さない）
        (date(2025, 5, 31), "other", -5, 100, 36),
        (date(2025, 5, 31), "other", -8, 50, 40),
        # 1日目は前日までの 36% で中くらい。1日目を含めると 18%（堅め）になるが、その日の値は使わない
        (date(2025, 6, 1), "other", -5, 100, 0),
        (date(2025, 6, 1), "other", -8, 10, 9),
        # 2日目は 36/200 = 18% で堅め
        (date(2025, 6, 2), "other", -5, 20, 5),
        # 期間の後は数えない
        (date(2025, 6, 3), "other", -5, 999, 999),
    ])
    acc = I.prelaunch_accuracy(counts, cfg)
    assert acc["from"] == "2025-06-01" and acc["to"] == "2025-06-02"
    assert acc["byLevel"] == {"low": {"n": 20, "nonWin": 5}, "mid": {"n": 100, "nonWin": 0},
                              "high": {"n": 0, "nonWin": 0}}
    assert acc["sparse"] == {"n": 10, "nonWin": 9}
    assert acc["base"] == {"n": 130, "nonWin": 14}


def test_prelaunch_cells_are_split_by_round():
    cfg = {**CFG, "prelaunch": {"from": "2025-06-01", "to": "2025-06-01"}, "minCellN": 100}
    counts = acc_counts([
        (date(2025, 5, 31), "other", 0, 100, 60),   # 60% 崩れやすい
        (date(2025, 5, 31), "junyu", 0, 100, 20),   # 同じ帯でも準優勝戦は 20% 堅め
        (date(2025, 6, 1), "other", 0, 10, 7),
        (date(2025, 6, 1), "junyu", 0, 10, 1),
    ])
    acc = I.prelaunch_accuracy(counts, cfg)
    assert acc["byLevel"]["high"] == {"n": 10, "nonWin": 7}
    assert acc["byLevel"]["low"] == {"n": 10, "nonWin": 1}


def test_postlaunch_counts_saved_level_against_complete_races():
    rows = pd.DataFrame({
        "race_id": [202610200101, 202610200102, 202610200103, 202610190101],
        "race_date": [date(2026, 10, 20)] * 3 + [date(2026, 10, 19)],
        "non_win": [1, 0, 1, 1],
    })
    levels = {202610200101: "high", 202610200102: "low", 202610190101: "high"}
    acc = I.postlaunch_accuracy(rows, levels, date(2026, 10, 20), date(2026, 10, 20))
    # 段の無いレース（0103）は base だけ。公開の前日（10/19）は数えない
    assert acc["byLevel"] == {"low": {"n": 1, "nonWin": 0}, "mid": {"n": 0, "nonWin": 0},
                              "high": {"n": 1, "nonWin": 1}}
    assert acc["base"] == {"n": 3, "nonWin": 2}
    assert acc["from"] == "2026-10-20" and acc["through"] == "2026-10-20"


class PagedDb:
    """GET を offset・limit で返す偽物（表と predictions）"""

    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    def __call__(self, method, path, body=None, prefer=None):
        self.calls.append((method, path))
        name = path.split("?")[0]
        q = dict(p.split("=", 1) for p in path.split("?")[1].split("&") if "=" in p)
        rows = self.tables.get(name, [])
        off, lim = int(q.get("offset", 0)), int(q.get("limit", len(rows) or 1))
        return rows[off:off + lim], {}


def test_fetch_all_reads_past_the_1000_row_limit():
    fake = PagedDb({"t": [{"i": i} for i in range(2500)]})
    assert len(I.fetch_all("t?select=i&order=i", fake)) == 2500
    assert [p.split("offset=")[1] for _, p in fake.calls] == ["0", "1000", "2000"]


def test_fetch_levels_keeps_valid_levels_and_converts_race_id():
    fake = PagedDb({"predictions": [{"race_id": "2026-10-20-02-04", "level": "high"},
                                    {"race_id": "2026-10-20-02-05", "level": None}]})
    assert I.fetch_levels(date(2026, 10, 20), date(2026, 10, 21), CFG, fake) == {202610200204: "high"}
    path = fake.calls[0][1]
    assert "model_id=eq.unified" in path and "race_id=gte.2026-10-20" in path and "race_id=lt.2026-10-22" in path
    assert f"feature_contributions->inCaution->>def=eq.{CFG['def']}" in path


def test_build_keeps_prelaunch_unless_full_or_missing_or_def_changed(monkeypatch):
    monkeypatch.setattr(I, "prelaunch_accuracy", lambda counts, cfg: {"made_from": len(counts)})
    table = [{"race_date": "2025-06-01", "round_grp": "other", "gap_band": 0, "n": 1, "non_win": 0}] * 3
    cfg = {**CFG, "launchDate": None}
    prev = {"def": CFG["def"], "prelaunch": {"old": True}}
    hi = date(2026, 10, 16)
    empty = acc_counts([])
    kept = I.build_accuracy(prev, empty, empty, hi, False, cfg, PagedDb({}), now="t")
    assert kept == {"calculatedAt": "t", "def": CFG["def"], "prelaunch": {"old": True}, "postlaunch": None}
    # 無いとき・def が違うときは表から作り直す（full でなければ CSV は直近だけなので表を読む）
    for p in (None, {**prev, "def": "old-def"}):
        assert I.build_accuracy(p, empty, empty, hi, False, cfg, PagedDb({I.TABLE: table}))["prelaunch"] == {
            "made_from": 3}
    # full は読み込んだ全期間の counts から作る（表は読まない）
    full_counts = acc_counts([(date(2025, 6, 1), "other", 0, 1, 0)] * 5)
    fake = PagedDb({})
    assert I.build_accuracy(prev, full_counts, empty, hi, True, cfg, fake)["prelaunch"] == {"made_from": 5}
    assert fake.calls == []


def test_build_postlaunch_only_after_launch_date():
    cfg = {**CFG, "launchDate": "2026-10-20"}
    prev = {"def": CFG["def"], "prelaunch": {"old": True}}
    rows = pd.DataFrame({"race_id": [202610200204], "race_date": [date(2026, 10, 20)], "non_win": [1]})
    fake = PagedDb({"predictions": [{"race_id": "2026-10-20-02-04", "level": "high"}]})
    before = I.build_accuracy(prev, acc_counts([]), rows, date(2026, 10, 19), False, cfg, fake)
    assert before["postlaunch"] is None
    after = I.build_accuracy(prev, acc_counts([]), rows, date(2026, 10, 20), False, cfg, fake)
    assert after["postlaunch"]["byLevel"]["high"] == {"n": 1, "nonWin": 1}


def test_main_writes_accuracy_after_the_table(monkeypatch):
    order = []
    monkeypatch.setattr(I, "in_quiet_hours", lambda now: False)
    monkeypatch.setattr(I, "load", lambda full: labelled({202610050101: [4.81, 5.12, 6.93, 3.2, 4.0, 5.5]}))
    monkeypatch.setattr(I, "write_table", lambda *a, **k: order.append("table") or {"rows": 1})
    monkeypatch.setattr(I, "read_accuracy", lambda: order.append("read") or None)
    monkeypatch.setattr(I, "build_accuracy", lambda *a, **k: order.append("build") or {
        "calculatedAt": "t", "def": "d", "prelaunch": {"byLevel": {}}, "postlaunch": None})
    monkeypatch.setattr(I, "write_accuracy", lambda data: order.append("accuracy"))
    I.main(["--date", "2026-10-06"])
    assert order == ["table", "read", "build", "accuracy"]


def test_write_accuracy_upserts_the_key():
    fake = FakeDb()
    I.write_accuracy({"calculatedAt": "t", "def": "d"}, fake)
    method, path, body, prefer = fake.calls[0]
    assert (method, path) == ("POST", "accuracy_cache?on_conflict=key")
    assert body == [{"key": "in_caution_accuracy", "data": {"calculatedAt": "t", "def": "d"}, "updated_at": "t"}]
    assert "resolution=merge-duplicates" in prefer
