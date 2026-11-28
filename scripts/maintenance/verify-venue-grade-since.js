// 会場×グレードの画面に出す集計の始まりの日（VenueGradeWinShare.jsx の VENUE_GRADE_STATS_SINCE）が、集計のバッチ（calculate-venue-grade-stats.js の CLEAN_DATA_SINCE）と同じであることを守る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pick = (text, name, file) => {
  const m = text.match(new RegExp(`const ${name} = "(\\d{4}-\\d{2}-\\d{2})"`));
  assert.ok(m, `${file} に ${name} = "YYYY-MM-DD" が無い`);
  return m[1];
};

const screen = pick(
  read("src/components/analysis/VenueGradeWinShare.jsx"),
  "VENUE_GRADE_STATS_SINCE",
  "VenueGradeWinShare.jsx",
);
const batch = pick(
  read("scripts/daily/calculate-venue-grade-stats.js"),
  "CLEAN_DATA_SINCE",
  "calculate-venue-grade-stats.js",
);
assert.equal(
  screen,
  batch,
  `画面の集計の始まり ${screen} とバッチの ${batch} が違う（どちらかを直す）`,
);
console.log(`verify-venue-grade-since: OK（${screen}）`);
