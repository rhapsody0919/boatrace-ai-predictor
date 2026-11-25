#!/usr/bin/env node
/**
 * verify-nigashi-stats.js - 逃し率（進入コースの走のうち、1コースの艇に逃げで1着を取られた走）が、実際の進入コースと決まり手「逃げ」だけで数え、全国の基準を走数で重み付けることを守る。
 * 純関数 src/pure/nigashiStats.js を照らす（枠別タブの2号艇のカード、オーナー 2026-11-25）。
 */
import assert from "node:assert/strict";
import {
  buildNigashiBreakdown,
  nationalNigashiBaseline,
  nigashiByCourse,
} from "../../src/pure/nigashiStats.js";

const now = new Date("2026-11-20T03:00:00Z");
const run = (o) => ({
  date: "2026-10-01",
  venueCode: 5,
  raceGrade: "一般",
  boatNumber: 2,
  actualCourse: 2,
  rank1: 1,
  winningTechnique: "逃げ",
  ...o,
});

const records = [
  run({ date: "2025-12-05" }),
  run({ winningTechnique: "差し", rank1: 2 }),
  run({ winningTechnique: "まくり", rank1: 3, date: "2026-11-10" }),
  // 前付けで艇番1のまま2コースに入った走も、実際の進入で数える
  run({ boatNumber: 1, winningTechnique: "逃げ" }),
  // ほかのコース・進入が分からない走は数えない
  run({ actualCourse: 3 }),
  run({ actualCourse: null }),
];

assert.deepEqual(buildNigashiBreakdown(records, 2, { now }), {
  n: 4,
  count: 2,
  pct: 50,
  from: "2025-12-05",
  to: "2026-11-10",
});
assert.equal(buildNigashiBreakdown(records, 3, { now }).n, 1);
assert.deepEqual(buildNigashiBreakdown(null, 2, { now }), {
  n: 0,
  count: 0,
  pct: null,
  from: null,
  to: null,
});

// 全国の基準は会場ごとの率を走数で重み付ける（単純平均ではない）。期間は端を合わせる
assert.deepEqual(
  nationalNigashiBaseline([
    { runs: 3000, nigashi_rate: "50.00", window_start: "2025-12-03", window_end: "2026-11-24" },
    { runs: 1000, nigashi_rate: "58.00", window_start: "2025-12-02", window_end: "2026-11-23" },
    { runs: 0, nigashi_rate: "90.00", window_start: "2025-01-01", window_end: "2026-11-25" },
    { runs: 500, nigashi_rate: null, window_start: "2025-01-01", window_end: "2026-11-25" },
  ]),
  { pct: 52, runs: 4000, from: "2025-12-02", to: "2026-11-24" },
);
assert.equal(nationalNigashiBaseline([]), null);
assert.equal(nationalNigashiBaseline(null), null);

// 選手ページの進入コース別（出走履歴の entryCourse で数える。1コース・進入が分からない走は数えない）
const hist = (o) => ({ raceId: "2026-01-10-05-03", entryCourse: 2, winningTechnique: "逃げ", ...o });
assert.deepEqual(
  nigashiByCourse([
    hist({ raceId: "2025-12-06-12-01" }),
    hist({ winningTechnique: "差し" }),
    hist({ entryCourse: 4, raceId: "2026-11-24-05-12" }),
    hist({ entryCourse: 1 }),
    hist({ entryCourse: null }),
  ]),
  {
    rows: [
      { course: 2, n: 2, count: 1, pct: 50 },
      { course: 4, n: 1, count: 1, pct: 100 },
    ],
    from: "2025-12-06",
    to: "2026-11-24",
  },
);
assert.deepEqual(nigashiByCourse(null), { rows: [], from: null, to: null });

console.log("OK: 逃し率の数え方と全国の基準・進入コース別");
