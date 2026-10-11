"""export_pool.js --daily（本体の前月・当月だけ DB から読む経路。v16 の朝のバッチも使う）"""
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def test_week_ranges_cover_month_without_gaps():
    script = ("import { weekRanges } from './scripts/ml/analogy/week-ranges.js';"
              "console.log(JSON.stringify(weekRanges('2026-09', '2026-10')));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True,
                         text=True, check=True, env={"PATH": os.environ["PATH"]})
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert r[0][0] == "2026-09-01" and r[-1][1] == "2026-10-01"
    assert all(a[1] == b[0] for a, b in zip(r, r[1:]))
