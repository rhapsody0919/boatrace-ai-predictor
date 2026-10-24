// BOA-1032: 仕様は scripts/lib/harville.js 冒頭の条件付き確率式と各公開関数のコメント。
import assert from "node:assert/strict";
import {
  BENTER_GAMMA, BENTER_DELTA, normalizeProbs, impliedProbsFromOdds,
  condSecond, condThird, exactaProb, trifectaProb, trioProb,
  trifectaProbFromCombo, trioProbFromCombo,
} from "../lib/harville.js";

const p = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04];
const sum = (values) => values.reduce((total, value) => total + value, 0);
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
};
const permutations = [];
for (let a = 0; a < 6; a++) {
  for (let b = 0; b < 6; b++) {
    for (let c = 0; c < 6; c++) {
      if (new Set([a, b, c]).size === 3) permutations.push([a, b, c]);
    }
  }
}

// 仕様の値: 条件付き確率を残った艇の集合から独立に計算する。
const specConditional = (boat, excluded, exponent) => {
  const remaining = p.filter((_, index) => !excluded.includes(index));
  return p[boat] ** exponent / sum(remaining.map((value) => value ** exponent));
};
const SPEC_VALUES = {
  gamma: 0.81,
  delta: 0.65,
  plain: p[0] * p[1] / (1 - p[0]) * p[2] / (1 - p[0] - p[1]),
  exacta: p[0] * specConditional(1, [0], 0.81),
  corrected: p[0] * specConditional(1, [0], 0.81) * specConditional(2, [0, 1], 0.65),
  trio: sum(permutations.filter((combo) => combo.every((boat) => boat < 3))
    .map(([a, b, c]) => p[a] * specConditional(b, [a], 0.81)
      * specConditional(c, [a, b], 0.65))),
  implied: [4 / 9, 2 / 9, 1 / 9, 1 / 9, 1 / 18, 1 / 18],
};
// 今の実装の値: 仕様の値と混ぜずに採取し、下の試験で照合する。
const IMPLEMENTATION_VALUES = {
  plain: trifectaProb(p, [0, 1, 2], { gamma: 1, delta: 1 }),
  corrected: trifectaProb(p, [0, 1, 2]),
  exacta: exactaProb(p, [0, 1]),
  trio: trioProb(p, [0, 1, 2]),
  implied: impliedProbsFromOdds([2, 4, 8, 8, 16, 16]),
};
// 不一致が見つかった入力は { input, specificationValue, implementationValue } で記録する。
// 今回の入力には既知の不一致なし。回帰を自動でこの配列へ逃がさない。
const KNOWN_GAPS = [];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}`, KNOWN_GAPS);

let passed = 0;
function check(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

check("Benter defaults and specification values", () => {
  assert.equal(BENTER_GAMMA, SPEC_VALUES.gamma);
  assert.equal(BENTER_DELTA, SPEC_VALUES.delta);
  for (const key of ["plain", "corrected", "exacta", "trio"]) {
    near(IMPLEMENTATION_VALUES[key], SPEC_VALUES[key], key);
  }
  assert.ok(IMPLEMENTATION_VALUES.corrected < IMPLEMENTATION_VALUES.plain);
});

for (const [gamma, delta] of [[1, 1], [0.81, 0.65], [0.5, 1.2]]) {
  const opts = { gamma, delta };
  check(`120 trifectas sum to 1 (gamma=${gamma}, delta=${delta})`, () => {
    assert.equal(permutations.length, 120);
    const probabilities = permutations.map((combo) => trifectaProb(p, combo, opts));
    probabilities.forEach((value) => assert.ok(value >= 0 && value <= 1));
    near(sum(probabilities), 1, "trifecta total");
  });
  check(`conditionals and 30 exacta marginals (gamma=${gamma}, delta=${delta})`, () => {
    const exactas = [];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        if (a === b) continue;
        near(condSecond(p, a, b, gamma), specConditional(b, [a], gamma), "second");
        const triples = permutations.filter(([first, second]) => first === a && second === b);
        for (const [, , c] of triples) {
          near(condThird(p, a, b, c, delta), specConditional(c, [a, b], delta), "third");
        }
        const exacta = exactaProb(p, [a, b], opts);
        near(sum(triples.map((combo) => trifectaProb(p, combo, opts))), exacta, "marginal");
        exactas.push(exacta);
      }
    }
    assert.equal(exactas.length, 30);
    near(sum(exactas), 1, "exacta total");
  });
  check(`trio six permutations and combo parsing (gamma=${gamma}, delta=${delta})`, () => {
    const six = permutations.filter((combo) => combo.every((boat) => boat < 3));
    assert.equal(six.length, 6);
    const expected = sum(six.map((combo) => trifectaProb(p, combo, opts)));
    near(trioProb(p, [0, 1, 2], opts), expected, "trio");
    near(trioProbFromCombo(p, "3-2-1", opts), expected, "trio combo");
    near(trifectaProbFromCombo(p, "1-2-3", opts), trifectaProb(p, [0, 1, 2], opts), "trifecta combo");
  });
}

check("invalid combo strings return null", () => {
  for (const combo of ["1-1-3", "1-2", "1-2-7"]) {
    assert.equal(trifectaProbFromCombo(p, combo), null, combo);
    assert.equal(trioProbFromCombo(p, combo), null, combo);
  }
});
check("implied odds specification and normalization", () => {
  IMPLEMENTATION_VALUES.implied.forEach((value, index) => {
    near(value, SPEC_VALUES.implied[index], `implied ${index}`);
  });
  near(sum(IMPLEMENTATION_VALUES.implied), 1, "implied total");
});
check("invalid odds clamp to 1e-9 before normalization", () => {
  const actual = impliedProbsFromOdds([2, 1, 0, -1, "x", NaN]);
  const denominator = 0.5 + 5e-9;
  actual.forEach((value, index) => {
    near(value, (index === 0 ? 0.5 : 1e-9) / denominator, `odds clamp ${index}`, 1e-12);
  });
  near(sum(actual), 1, "invalid odds total");
});
check("normalizeProbs clamps invalid probabilities", () => {
  const actual = normalizeProbs([0, -1, 1, "x"]);
  actual.forEach((value, index) => {
    near(value, (index === 2 ? 1 : 1e-9) / (1 + 3e-9), `probability clamp ${index}`, 1e-12);
  });
  near(sum(actual), 1, "normalized total");
});
console.log(`harville verify: ${passed} tests passed`);
