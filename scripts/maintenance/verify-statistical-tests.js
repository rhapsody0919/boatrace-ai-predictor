#!/usr/bin/env node
/**
 * BOA-1043 / ADR-0020: 実装値から独立した既知値で検証する。
 * Φ(z) = erfc(-z/√2)/2（依頼の Python math.erfc による値）。
 * A&S 7.1.26 の erf 誤差 ≤ 1.5e-7 → Φ 誤差 ≤ 7.5e-8。
 * CDF は 1e-7、両側p値は 1e-6、相関と対称性は 1e-12。
 */
import assert from "node:assert/strict";
import {
  normalCDF,
  pearsonCorrelation,
  pearsonPValue,
  proportionZTest,
} from "../lib/statisticalTests.js";

const KNOWN_GAPS = [
  {
    input: "pearsonCorrelation([1,1,1], [1,2,3])",
    specification: "未定（分散0）",
    current: "NaN",
  },
  {
    input: "pearsonCorrelation([], [])",
    specification: "未定（空配列）",
    current: "NaN",
  },
  {
    input: "proportionZTest(3, 10, 1.5)",
    specification: "未定（baselinePが範囲外）",
    current: "NaN",
  },
];

let passed = 0;
let failed = 0;
function check(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}: ${error.message}`);
  }
}
function near(actual, expected, tolerance) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `actual=${actual}, expected=${expected}, tolerance=${tolerance}`,
  );
}

for (const [z, expected] of [
  [0, 0.5],
  [1, 0.8413447461],
  [1.96, 0.9750021049],
  [-1.96, 0.0249978951],
  [3, 0.9986501020],
]) {
  check(`normalCDF(${z}) の既知値`, () => near(normalCDF(z), expected, 1e-7));
}
for (const z of [0.5, 1, 1.96, 3]) {
  check(`normalCDF の対称 z=${z}`, () => {
    near(normalCDF(z) + normalCDF(-z), 1, 1e-12);
  });
}
for (const [y, expected] of [[[2, 4, 6], 1], [[3, 2, 1], -1]]) {
  check(`pearsonCorrelation の完全相関 r=${expected}`, () => {
    near(pearsonCorrelation([1, 2, 3], y), expected, 1e-12);
  });
}
check("pearsonCorrelation の Anscombe I", () => {
  // Anscombe (1973), Graphs in Statistical Analysis, 27(1):17–21。
  // 原典の丸めた r=0.816 と比べるため、誤差は 5e-4。
  near(pearsonCorrelation(
    [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5],
    [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68],
  ), 0.816, 5e-4);
});
for (const n of [1, 2]) {
  check(`pearsonPValue の n<=2 n=${n}`, () => {
    assert.equal(pearsonPValue(0.5, n), 1);
  });
}
for (const r of [1, -1]) {
  check(`pearsonPValue の完全相関 r=${r}`, () => {
    assert.equal(pearsonPValue(r, 10), 0);
  });
}
check("pearsonPValue の無相関", () => near(pearsonPValue(0, 100), 1, 1e-6));
check("pearsonPValue の正規近似の両側p値", () => {
  // t=r√((n−2)/(1−r²)), p=2(1−Φ(|t|))。t分布の厳密値ではない。
  near(pearsonPValue(0.1, 1000), 0.0014982161, 1e-6);
});
check("proportionZTest の trials=0", () => {
  assert.equal(proportionZTest(0, 0, 0.5), 1);
});
for (const baselineP of [0, 1]) {
  check(`proportionZTest の se=0 baselineP=${baselineP}`, () => {
    assert.equal(proportionZTest(3, 10, baselineP), 1);
  });
}
check("proportionZTest の z=0", () => near(proportionZTest(5, 10, 0.5), 1, 1e-6));
for (const successes of [60, 40]) {
  check(`proportionZTest の両側p値 successes=${successes}`, () => {
    near(proportionZTest(successes, 100, 0.5), 0.0455002639, 1e-6);
  });
}
check("proportionZTest の対称", () => {
  assert.equal(proportionZTest(60, 100, 0.5), proportionZTest(40, 100, 0.5));
});

console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（仕様未定のためassertしない）`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`statisticalTests: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
