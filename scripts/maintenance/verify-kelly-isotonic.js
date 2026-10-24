// BOA-1069: Kelly の定義と PAV のブロック平均を固定する。本体は変更しない。
import assert from "node:assert/strict";
import { kellyFraction, halfKelly, quarterKelly } from "../lib/kelly-criterion.js";
import { IsotonicCalibrator } from "../lib/isotonic-regression.js";

// odds <= 1 の扱いはコメントに仕様が無い。観測値を仕様として固定しない。
const KNOWN_GAPS = [
  { input: { probability: 0.5, odds: 1 }, specificationValue: "未定", implementationValue: kellyFraction(0.5, 1) },
  { input: { probability: 0.9, odds: 0.5 }, specificationValue: "未定", implementationValue: kellyFraction(0.9, 0.5) },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（assert 対象外）`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));

function check(name, run) {
  try {
    run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}
function near(actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12,
    `expected ${expected}, got ${actual}`);
}
function nearArray(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => near(value, expected[index]));
}

check("Kelly 定義の正の賭け率", () => {
  // b=2, p=q=1/2 より (1-1/2)/2=1/4。
  near(kellyFraction(0.5, 3), 0.25);
});
check("Kelly 負の期待値を0に切る", () => {
  near(kellyFraction(0.2, 3), 0);
});
check("halfKelly は定義の半分", () => {
  near(halfKelly(0.5, 3), 0.125);
});
check("quarterKelly は定義の4分の1", () => {
  near(quarterKelly(0.5, 3), 0.0625);
});

const scores = [0.1, 0.2, 0.3, 0.4];
const cal = new IsotonicCalibrator();
cal.fit(scores, [0, 1, 0, 1]);
check("PAV 隣接違反の平均", () => {
  // 中央の [1,0] を平均して [0,1/2,1/2,1]。
  nearArray(cal.predict(scores), [0, 0.5, 0.5, 1]);
});
check("PAV 範囲外は端の値", () => {
  near(cal.predict(0), 0);
  near(cal.predict(0.9), 1);
});
check("PAV 補間と単調非減少", () => {
  const predictions = cal.predict([0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.9]);
  nearArray(predictions, [0, 0, 0.25, 0.5, 0.5, 0.5, 0.75, 1, 1]);
  for (let i = 1; i < predictions.length; i++) {
    assert.ok(predictions[i] >= predictions[i - 1]);
  }
});
check("PAV JSON 往復で予測を保持", () => {
  const restored = IsotonicCalibrator.fromJSON(JSON.parse(JSON.stringify(cal.toJSON())));
  nearArray(restored.predict(scores), [0, 0.5, 0.5, 1]);
  nearArray(restored.predict([0, 0.15, 0.35, 0.9]), [0, 0.25, 0.75, 1]);
});
check("PAV 連続違反の重み付き平均と後戻り", () => {
  const pooled = new IsotonicCalibrator();
  pooled.fit([1, 2, 3, 4], [1, 1, 0, 0]);
  nearArray(pooled.predict([1, 2, 3, 4]), [0.5, 0.5, 0.5, 0.5]);
});
console.log("verify-kelly-isotonic: 全9試験通過");
