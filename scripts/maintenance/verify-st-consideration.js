#!/usr/bin/env node
/**
 * BOA-1031: ST考察の純関数を固定する（ネットワーク・DB・実時刻不要）。
 * 仕様: stConsideration.js 冒頭・各関数のコメント、および
 * docs/design/analysis-visualization-upgrade/spec.md「ST考察の算出可否」。
 * specValue は定義から求めた値、currentValue は指定SHA 66e664c15 の値。
 * 一致した入力だけを回帰試験にする。不一致は KNOWN_GAPS に記録する。
 */
import assert from "node:assert/strict";
import {
  deriveRaceStContext,
  computeStConsideration,
  computeStHistogram,
  getStHistory,
  ST_HISTOGRAM_BINS,
} from "../../src/utils/stConsideration.js";

// 発見時の形式: { input, specValue, currentValue }。今回の入力では不一致なし。
const KNOWN_GAPS = [];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, JSON.stringify(KNOWN_GAPS));
let failures = 0;
let checks = 0;
function check(name, run) {
  checks++;
  try {
    run();
    console.log(`✅ ${name}`);
  } catch (error) {
    failures++;
    console.error(`❌ ${name}\n${error.message}`);
  }
}
function exact(actual, specValue, currentValue) {
  assert.deepEqual(currentValue, specValue, "仕様の値と今の実装の値");
  assert.deepEqual(actual, currentValue);
}
function near(actual, specValue, currentValue, tolerance = 0.005) {
  assert.equal(currentValue, specValue, "仕様の値と今の実装の値");
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - currentValue) < tolerance,
    `expected ${currentValue} ± ${tolerance}, got ${actual}`,
  );
}

const stRows = [0.15, 0.20, 0.15, 0.05, 0.08, null].map(
  (start_timing, i) => ({ boat_number: i + 1, start_timing, is_flying: i === 3 }),
);
const result = Object.fromEntries(
  stRows.map((r) => [`actual_course_${r.boat_number}`, r.boat_number]),
);
check("deriveRaceStContext: F・欠損の除外、同タイム同順位、内側の最速", () => {
  const { raceBestSt, byBoat } = deriveRaceStContext(stRows, result);
  exact(raceBestSt, 0.08, 0.08);
  exact([...byBoat.keys()], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);
  const actual = [...byBoat.values()].map((v) => [
    v.course, v.stForRank, v.stRank, v.innerMinSt, v.isFlying,
  ]);
  // 仕様の値: 順位は1,2,2,4。Fの0.05は内側最速にも含めない。
  const specValue = [
    [1, 0.15, 2, null, false], [2, 0.20, 4, 0.15, false],
    [3, 0.15, 2, 0.15, false], [4, null, null, 0.15, true],
    [5, 0.08, 1, 0.15, false], [6, null, null, 0.08, false],
  ];
  // 今の実装の値（同じ入力、指定SHA）。
  const currentValue = [
    [1, 0.15, 2, null, false], [2, 0.20, 4, 0.15, false],
    [3, 0.15, 2, 0.15, false], [4, null, null, 0.15, true],
    [5, 0.08, 1, 0.15, false], [6, null, null, 0.08, false],
  ];
  exact(actual, specValue, currentValue);
});
check("deriveRaceStContext: 空配列と結果なし", () => {
  exact(deriveRaceStContext([], null),
    { raceBestSt: null, byBoat: new Map() },
    { raceBestSt: null, byBoat: new Map() });
  const { byBoat } = deriveRaceStContext(stRows, null);
  for (const v of byBoat.values()) {
    exact([v.course, v.innerMinSt], [null, null], [null, null]);
  }
});

const course3 = [
  { actualCourse: 3, stForRank: 0.20, raceBestSt: 0.15, innerMinSt: 0.27 },
  { actualCourse: 3, stForRank: 0.25, raceBestSt: 0.15, innerMinSt: 0.10 },
  { actualCourse: 3, stForRank: null, isFlying: true },
  { actualCourse: 3, stForRank: 0.12, raceBestSt: 0.12, innerMinSt: null },
];
check("computeStConsideration: 0.05安定・0.10出遅・0.07抜出の境界と母数", () => {
  const value = computeStConsideration(course3, { course: 3 });
  exact([value.n, value.breakoutCount, value.flyingCount], [3, 1, 1], [3, 1, 1]);
  near(value.stableRate, 66.67, 66.67);
  near(value.lateRate, 33.33, 33.33);
  near(value.breakoutRate, 50, 50);
  near(value.avgSt, 0.19, 0.19, 1e-12);
});
check("computeStConsideration: 1コースの抜出はnull、安定率100", () => {
  const value = computeStConsideration([
    { actualCourse: 1, stForRank: 0.10, raceBestSt: 0.10 },
    ...course3,
  ], { course: 1 });
  exact(value,
    { n: 1, stableRate: 100, lateRate: 0, breakoutCount: null,
      breakoutRate: null, avgSt: 0.10, flyingCount: 0 },
    { n: 1, stableRate: 100, lateRate: 0, breakoutCount: null,
      breakoutRate: null, avgSt: 0.10, flyingCount: 0 });
});
check("computeStConsideration: 空配列の率はnull、抜出回数はコース別", () => {
  for (const course of [1, 4]) {
    exact(computeStConsideration([], { course }),
      { n: 0, stableRate: null, lateRate: null, breakoutCount: course === 1 ? null : 0,
        breakoutRate: null, avgSt: null, flyingCount: 0 },
      { n: 0, stableRate: null, lateRate: null, breakoutCount: course === 1 ? null : 0,
        breakoutRate: null, avgSt: null, flyingCount: 0 });
  }
});
check("computeStConsideration: 閾値直外の0.051・直前の0.099と0.069", () => {
  const value = computeStConsideration([
    { actualCourse: 2, stForRank: 0.201, raceBestSt: 0.15, innerMinSt: 0.27 },
    { actualCourse: 2, stForRank: 0.249, raceBestSt: 0.15, innerMinSt: 0.10 },
  ], { course: 2 });
  exact([value.stableRate, value.lateRate, value.breakoutCount], [0, 0, 0], [0, 0, 0]);
});

check("computeStHistogram: ビンのキー・0.30/0.05/0.049の境界", () => {
  exact(ST_HISTOGRAM_BINS,
    ["0.00", "0.05", "0.10", "0.15", "0.20", "0.25", "0.30+"],
    ["0.00", "0.05", "0.10", "0.15", "0.20", "0.25", "0.30+"]);
  const rows = [0.30, 0.05, 0.049].map((stForRank) => ({ actualCourse: 2, stForRank }));
  const value = computeStHistogram([...rows, ...course3], { course: 2 });
  exact(value,
    { total: 3, bins: { "0.00": 1, "0.05": 1, "0.10": 0, "0.15": 0,
      "0.20": 0, "0.25": 0, "0.30+": 1 } },
    { total: 3, bins: { "0.00": 1, "0.05": 1, "0.10": 0, "0.15": 0,
      "0.20": 0, "0.25": 0, "0.30+": 1 } });
  assert.equal(value.total, computeStConsideration(rows, { course: 2 }).n);
});
check("computeStHistogram: Fを除外し、合計はST考察のnと一致", () => {
  const value = computeStHistogram(course3, { course: 3 });
  exact(value,
    { total: 3, bins: { "0.00": 0, "0.05": 0, "0.10": 1, "0.15": 0,
      "0.20": 1, "0.25": 1, "0.30+": 0 } },
    { total: 3, bins: { "0.00": 0, "0.05": 0, "0.10": 1, "0.15": 0,
      "0.20": 1, "0.25": 1, "0.30+": 0 } });
  assert.equal(value.total, computeStConsideration(course3, { course: 3 }).n);
});
check("getStHistory: 指定コースだけ入力の逆順、Fを含め、入力は不変", () => {
  const rows = Object.freeze([
    ...course3.map((r, id) => Object.freeze({ ...r, id })),
    Object.freeze({ actualCourse: 1, stForRank: 0.10, id: 4 }),
  ]);
  const before = structuredClone(rows);
  const history = getStHistory(rows, { course: 3 });
  exact(history.map((r) => r.id), [3, 2, 1, 0], [3, 2, 1, 0]);
  exact(history[1].isFlying, true, true);
  assert.deepEqual(rows, before);
  assert.notEqual(history, rows);
  exact(getStHistory([], { course: 3 }), [], []);
});

console.log(`${checks}件中 ${failures}件失敗`);
if (failures) process.exitCode = 1;
