#!/usr/bin/env node
/**
 * BOA-1085: courseBaseline.js の JSDoc・コメント、ADR-0068 の参照単位を固定する。
 * DB・ネットワーク・実時刻に依存しない。diffFromBaseline / diffTone は既存 verify の範囲。
 */
import assert from "node:assert/strict";
import {
  indexBaseline,
  getBaselineCell,
  expectedBreakoutCount,
  METRIC_DIRECTION,
} from "../../src/utils/courseBaseline.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });
const near = (actual, expected) => {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} != ${expected}`);
};

test("indexBaseline: Map のキー・欠損行の除外・course 0・後勝ち", () => {
  const last = { course: 1, grade: "A1", stable_rate: 70 };
  const zero = { course: 0, grade: "B2" };
  const rows = [
    { course: 1, grade: "A1", stable_rate: 74.4 },
    { course: null, grade: "A1" },
    { course: undefined, grade: "A1" },
    { course: 2, grade: "" },
    { course: 2, grade: null },
    { course: 2 },
    zero,
    last,
  ];
  const map = indexBaseline(rows);
  assert.ok(map instanceof Map);
  assert.deepEqual([...map.keys()], ["1-A1", "0-B2"]);
  assert.strictEqual(map.get("1-A1"), last);
  assert.equal(map.get("1-A1").stable_rate, 70);
  assert.strictEqual(map.get("0-B2"), zero);
});

for (const rows of [null, undefined, []]) {
  test(`indexBaseline: ${JSON.stringify(rows)} は空の Map`, () => {
    const map = indexBaseline(rows);
    assert.ok(map instanceof Map);
    assert.equal(map.size, 0);
  });
}

test("indexBaseline: 入力の配列・行を変えない", () => {
  const first = Object.freeze({ course: 1, grade: "A1", stable_rate: 74.4 });
  const last = Object.freeze({ course: 1, grade: "A1", stable_rate: 70 });
  const rows = Object.freeze([first, last]);
  const before = structuredClone(rows);
  const map = indexBaseline(rows);
  assert.deepEqual(rows, before);
  assert.strictEqual(rows[0], first);
  assert.strictEqual(rows[1], last);
  assert.strictEqual(map.get("1-A1"), last);
});

test("getBaselineCell: コースと級別の両方で同じ行を引く・無いキーは null", () => {
  // indexBaseline を使わず、参照側のキーの誤りを独立に検出する。
  const a1 = { course: 1, grade: "A1", stable_rate: 74.4 };
  const b2 = { course: 1, grade: "B2", stable_rate: 56.5 };
  const second = { course: 2, grade: "A1", stable_rate: 66.8 };
  const zero = { course: 0, grade: "B2" };
  const map = new Map([["1-A1", a1], ["1-B2", b2], ["2-A1", second], ["0-B2", zero]]);
  assert.strictEqual(getBaselineCell(map, 1, "A1"), a1);
  assert.strictEqual(getBaselineCell(map, 1, "B2"), b2);
  assert.strictEqual(getBaselineCell(map, 2, "A1"), second);
  assert.strictEqual(getBaselineCell(map, 0, "B2"), zero);
  assert.equal(getBaselineCell(map, 2, "B2"), null);
});

for (const [name, map, course, grade] of [
  ["Map null", null, 1, "A1"],
  ["course null", new Map([["null-A1", {}]]), null, "A1"],
  ["course undefined", new Map([["undefined-A1", {}]]), undefined, "A1"],
  ["grade 空", new Map([["1-", {}]]), 1, ""],
  ["grade null", new Map([["1-null", {}]]), 1, null],
  ["grade undefined", new Map([["1-undefined", {}]]), 1, undefined],
]) {
  test(`getBaselineCell: ${name} は null`, () => {
    assert.equal(getBaselineCell(map, course, grade), null);
  });
}

for (const [rate, runs, expected] of [[7, 30, 2.1], ["7", 30, 2.1], [0, 30, 0], [100, 8, 8], [7, 10, 0.7]]) {
  test(`expectedBreakoutCount: (${JSON.stringify(rate)}, ${runs}) → ${expected}`, () => {
    near(expectedBreakoutCount(rate, runs), expected);
  });
}
for (const rate of [null, undefined]) {
  test(`expectedBreakoutCount: rate ${rate} は null`, () => {
    assert.equal(expectedBreakoutCount(rate, 30), null);
  });
}
for (const runs of [0, -1, NaN, Infinity, -Infinity]) {
  test(`expectedBreakoutCount: runs ${runs} は null`, () => {
    assert.equal(expectedBreakoutCount(7, runs), null);
  });
}

test("METRIC_DIRECTION: コメントの良い向き", () => {
  assert.deepEqual(METRIC_DIRECTION, {
    stableRate: "higher-is-better",
    lateRate: "lower-is-better",
    breakoutCount: "higher-is-better",
    avgSt: "lower-is-better",
  });
});

// JSDoc の runs:number の外。仕様が未定の入力は assert で現状を固定しない。
const KNOWN_GAPS = [{
  input: { baselineRate: 7, runs: "30" },
  specification: "未定（runs は number 型。文字列の数を受け付けるかは仕様の外）",
  actual: expectedBreakoutCount(7, "30"),
}];

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${String(error.message).replace(/\s+/g, " ")}`);
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`${tests.length - failures}/${tests.length} PASS`);
if (failures > 0) process.exitCode = 1;
