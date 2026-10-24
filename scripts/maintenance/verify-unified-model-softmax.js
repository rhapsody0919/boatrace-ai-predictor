/** BOA-1063: softmax の数学的定義と unifiedModel.js の JSDoc を固定する。 */
import assert from "node:assert/strict";
import { softmaxProbabilities } from "../lib/unifiedModel.js";

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual} (tolerance ${tolerance})`,
  );
}

const tests = [
  ["空配列と null は空配列", () => {
    assert.deepEqual(softmaxProbabilities([]), []);
    assert.deepEqual(softmaxProbabilities(null), []);
  }],
  ["確率の合計・降順・入力キーの保持", () => {
    const input = [
      { number: 1, score: -240, label: "a" },
      { number: 2, score: 120, label: "b" },
      { number: 3, score: 0, label: "c" },
      { number: 4, score: 240, label: "d" },
      { number: 5, score: -120, label: "e" },
      { number: 6, score: 60, label: "f" },
    ];
    const result = softmaxProbabilities(input);
    assert.equal(result.length, input.length);
    near(result.reduce((sum, boat) => sum + boat.prob, 0), 1);
    assert.deepEqual(result.map((boat) => boat.number), [4, 2, 6, 3, 5, 1]);
    for (const [index, boat] of result.entries()) {
      assert.ok(boat.prob >= 0 && boat.prob <= 1);
      if (index > 0) assert.ok(result[index - 1].prob >= boat.prob);
      const { prob, ...rest } = boat;
      assert.deepEqual(rest, input.find((item) => item.number === boat.number));
      assert.ok(Number.isFinite(prob));
    }
  }],
  ["同点の2艇は各0.5", () => {
    const result = softmaxProbabilities([{ number: 1, score: 50 }, { number: 2, score: 50 }]);
    assert.equal(result.length, 2);
    result.forEach((boat) => near(boat.prob, 0.5));
  }],
  ["温度1の2艇はロジスティックの定義値", () => {
    const result = softmaxProbabilities([{ number: 1, score: 0 }, { number: 2, score: 1 }], 1);
    assert.deepEqual(result.map((boat) => boat.number), [2, 1]);
    near(result[0].prob, 0.7310585786300049, 1e-9);
    near(result[1].prob, 0.2689414213699951, 1e-9);
  }],
  ["既定温度120は差120で同じ確率", () => {
    const result = softmaxProbabilities([{ number: 1, score: 0 }, { number: 2, score: 120 }]);
    assert.deepEqual(result.map((boat) => boat.number), [2, 1]);
    near(result[0].prob, 0.7310585786300049, 1e-9);
    near(result[1].prob, 0.2689414213699951, 1e-9);
  }],
  ["一定加算で確率不変・大きなスコアでも有限", () => {
    const result = softmaxProbabilities([{ number: 1, score: 1000 }, { number: 2, score: 1001 }], 1);
    assert.deepEqual(result.map((boat) => boat.number), [2, 1]);
    near(result[0].prob, 0.7310585786300049, 1e-9);
    near(result[1].prob, 0.2689414213699951, 1e-9);
  }],
];

// JSDoc に仕様がない入力。現在値は観測だけに使い、assert しない。
const KNOWN_GAPS = [
  { input: { scores: [0, NaN], temperature: 1 }, specification: "未定" },
  { input: { scores: [0, Infinity], temperature: 1 }, specification: "未定" },
  { input: { scores: [0, 1], temperature: 0 }, specification: "未定" },
  { input: { scores: [0, 1], temperature: -1 }, specification: "未定" },
].map((gap) => ({
  ...gap,
  current: softmaxProbabilities(
    gap.input.scores.map((score, index) => ({ number: index + 1, score })),
    gap.input.temperature,
  ),
}));

let failures = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name}\n${error.stack}`);
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
console.dir(KNOWN_GAPS, { depth: null });
if (failures > 0) process.exitCode = 1;
