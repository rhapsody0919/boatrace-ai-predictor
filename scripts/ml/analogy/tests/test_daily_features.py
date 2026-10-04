"""日次の特徴量ジョブ（daily_features.py、plan「学習側の設計」）"""

import json
import subprocess
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import daily_features as DF

ROOT = Path(__file__).resolve().parents[4]
NOW = datetime(2026, 10, 3, 6, 40, tzinfo=DF.JST)


def race(rid, start, cancel=None):
    return {"race_id": rid, "race_date": rid[:10], "start_time": start, "cancellation_status": cancel}


def test_targets_need_lead_time_and_exclude_cancelled_absent_and_unknown_deadline():
    races = [race("2026-10-03-01-01", "08:32:00"), race("2026-10-03-01-02", "06:49:00"),
             race("2026-10-03-01-03", "06:50:00"), race("2026-10-03-02-01", "09:00:00", "confirmed"),
             race("2026-10-03-03-01", "09:00:00"), race("2026-10-03-04-01", None)]
    got = DF.select_targets(races, {"2026-10-03-03-01"}, NOW)
    assert got == ["2026-10-03-01-01", "2026-10-03-01-03"]


def test_rows_to_write_skips_same_hash_and_marks_overwrites():
    rows = [{"race_id": "r", "boat_number": b, "input_hash": f"h{b}"} for b in (1, 2, 3)]
    existing = {("r", 1): "h1", ("r", 2): "old"}
    out = DF.rows_to_write(rows, existing, NOW)
    assert [r["boat_number"] for r in out] == [2, 3]
    assert out[0]["updated_at"] == NOW.isoformat() and out[1]["updated_at"] is None
    assert all(set(r) == set(out[0]) for r in out)  # バルク upsert のキーの集合をそろえる


def test_missing_races_require_six_boats():
    rows = [{"race_id": "a"}] * 6 + [{"race_id": "b"}] * 5
    assert DF.missing_races(["a", "b", "c"], rows) == ["b", "c"]


def test_feature_rows_follow_names_and_hash_includes_version():
    df = pd.DataFrame({"race_id": [202610030101] * 6, "boat_number": range(1, 7),
                       "x": np.float32([0.1, np.nan, 3, 4, 5, 6]), "y": np.float32(np.arange(6))})
    rows = DF.feature_rows(df, ["2026-10-03-01-01"], ["y", "x"], "v1")
    assert len(rows) == 6 and rows[0]["race_id"] == "2026-10-03-01-01"
    assert rows[0]["features"] == [0.0, float(np.float32(0.1))]
    assert rows[1]["features"][1] is None
    assert rows[0]["input_hash"] != DF.feature_rows(df, ["2026-10-03-01-01"], ["y", "x"], "v2")[0]["input_hash"]


def test_week_ranges_cover_month_without_gaps():
    script = ("import { weekRanges } from './scripts/ml/analogy/week-ranges.js';"
              "console.log(JSON.stringify(weekRanges('2026-09', '2026-10')));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True,
                         text=True, check=True, env={"PATH": __import__("os").environ["PATH"]})
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert r[0][0] == "2026-09-01" and r[-1][1] == "2026-10-01"
    assert all(a[1] == b[0] for a, b in zip(r, r[1:]))


def test_paged_reads_order_by_primary_key(monkeypatch):
    """offset で読むので、order は一意（race_id だけだと 1,000 行を超える日にページの間で行が抜ける）"""
    paths = []

    def fake(method, path, body=None, prefer=None):
        paths.append(path)
        return [], {}
    monkeypatch.setattr(DF.db, "request", fake)
    DF._get_all("race_entries?select=race_id&order=race_id,boat_number")
    src = Path(DF.__file__).read_text()
    for table in ("race_entries?", "analogy_race_features?"):
        i = src.index(table)
        assert "order=race_id,boat_number" in src[i:i + 200], table
