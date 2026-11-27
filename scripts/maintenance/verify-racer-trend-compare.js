#!/usr/bin/env node
// 選手ページの推移の比べる相手（同じレースの他の5艇の展示の平均・今の級×同じ進入コースの ST の全国平均）の値を守る
/**
 * オーナー 2026-11-27（ファン4人の議論の推奨）。
 * - buildRacerRaceHistoryRows の othersExhibitionAvg: 同じレースの自分以外の艇の展示タイムの平均。展示の無い艇は数えず、
 *   他に1艇も無ければ null
 * - stCourseGradeAvg: 今の級の行から各走の進入コースの avg_st を引き、F・ST の無い走・基準の無いコースを除いて平均
 */
import assert from "node:assert/strict";
import { buildRacerRaceHistoryRows } from "../../src/services/racerRaceHistoryRows.js";
import { stCourseGradeAvg } from "../../src/pure/racerStBaseline.js";

const race = (id) => ({ race_id: id, venue_code: 2, race_grade: "ippan" });
const result = (id) => ({
  race_id: id,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  race_status: "finished",
});
const rows = buildRacerRaceHistoryRows({
  entries: [
    { race_id: "2026-11-01-02-01", boat_number: 1 },
    { race_id: "2026-11-02-02-01", boat_number: 3 },
  ],
  raceRows: [race("2026-11-01-02-01"), race("2026-11-02-02-01")],
  resultRows: [result("2026-11-01-02-01"), result("2026-11-02-02-01")],
  exhibitionRows: [
    { race_id: "2026-11-01-02-01", boat_number: 1, exhibition_time: 6.7 },
    { race_id: "2026-11-01-02-01", boat_number: 2, exhibition_time: 6.8 },
    { race_id: "2026-11-01-02-01", boat_number: 3, exhibition_time: 6.9 },
    // 展示の無い艇は数えない
    { race_id: "2026-11-01-02-01", boat_number: 4, exhibition_time: null },
    { race_id: "2026-11-02-02-01", boat_number: 3, exhibition_time: 6.75 },
  ],
  conditionRows: [],
  stRows: [],
});
const byId = new Map(rows.map((r) => [r.raceId, r]));
assert.ok(
  Math.abs(byId.get("2026-11-01-02-01").othersExhibitionAvg - 6.85) < 1e-9,
  "他の艇（2・3号艇）の展示の平均",
);
assert.equal(
  byId.get("2026-11-02-02-01").othersExhibitionAvg,
  null,
  "他の艇に展示が無ければ null",
);

const base = [
  {
    course: 1,
    grade: "A1",
    avg_st: 0.14,
    window_start: "2025-12-01",
    window_end: "2026-11-26",
  },
  { course: 4, grade: "A1", avg_st: 0.16 },
  { course: 1, grade: "B1", avg_st: 0.18 },
];
const avg = stCourseGradeAvg(
  [
    { startTiming: 0.12, isFlying: false, entryCourse: 1 },
    { startTiming: 0.15, isFlying: false, entryCourse: 4 },
    // F・ST の無い走・基準の無いコースは除く
    { startTiming: -0.01, isFlying: true, entryCourse: 1 },
    { startTiming: null, isFlying: false, entryCourse: 1 },
    { startTiming: 0.2, isFlying: false, entryCourse: 6 },
  ],
  base,
  "A1",
);
assert.ok(
  Math.abs(avg.value - 0.15) < 1e-9,
  "1コース .14 と4コース .16 の平均",
);
assert.equal(avg.n, 2);
assert.equal(avg.windowStart, "2025-12-01");
assert.equal(stCourseGradeAvg([], base, "A1"), null, "走が無ければ null");
assert.equal(
  stCourseGradeAvg(
    [{ startTiming: 0.1, isFlying: false, entryCourse: 1 }],
    base,
    null,
  ),
  null,
  "級が無ければ null",
);
assert.equal(
  stCourseGradeAvg(
    [{ startTiming: 0.1, isFlying: false, entryCourse: 1 }],
    null,
    "A1",
  ),
  null,
  "基準が取れなければ null",
);

console.log("verify-racer-trend-compare: OK");
