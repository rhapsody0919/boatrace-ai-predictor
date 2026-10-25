#!/usr/bin/env node
/** BOA-1084: ADR-0071 の純関数の式・単位を固定する。DB・時計・ネットワークは不要。 */
import assert from "node:assert/strict";
import {
  computeSkillDelta,
  computePredicted,
  computeZScore,
  isSmallSampleByRuns,
  clearsThresholdWithConfidence,
  wilsonLowerPercentFromCount,
  MIN_RELIABLE_RUNS,
  EXTRACTION_THRESHOLDS,
} from "../../src/utils/digestMetrics.js";
import { wilsonLowerBound, wilsonLowerBoundFromRate, isSmallSample } from "../../src/utils/wilson.js";

const cases = [];
const test = (name, run) => cases.push([name, run]);

test("地力: rate − expected を小数1桁のptにする", () => {
  // x.x5 ちょうどの丸め境界は KNOWN_GAPS に分離する。
  assert.equal(computeSkillDelta({ rate: 60, expected: 52.34 }), 7.7);
  assert.equal(computeSkillDelta({ rate: 40, expected: 52.34 }), -12.3);
  assert.equal(computeSkillDelta({ rate: 0, expected: 100 }), -100);
  assert.equal(computeSkillDelta({ rate: 100, expected: 0 }), 100);
  assert.equal(computeSkillDelta({ rate: 50, expected: 50 }), 0);
});
for (const field of ["rate", "expected"]) {
  for (const invalid of [-1, 101, NaN, Infinity, -Infinity]) {
    test(`地力: ${field}=${invalid} を拒否する`, () => {
      assert.throws(
        () => computeSkillDelta({ rate: 50, expected: 50, [field]: invalid }),
        new RegExp(`${field} は0〜100のパーセントである必要があります`),
      );
    });
  }
}
for (const [venueBaseline, skillDelta, value, clamped] of [
  [90, 15, 100, true],
  [5, -8, 0, true],
  [50, 3.26, 53.3, false],
  [50, -3.26, 46.7, false],
  [100, 0, 100, false],
  [0, 0, 0, false],
]) {
  test(`予測: baseline=${venueBaseline}, delta=${skillDelta} のクランプと丸め`, () => {
    assert.deepEqual(computePredicted({ venueBaseline, skillDelta }), { value, clamped });
  });
}
for (const venueBaseline of [-1, 101, NaN, Infinity]) {
  test(`予測: baseline=${venueBaseline} を拒否する`, () => {
    assert.throws(
      () => computePredicted({ venueBaseline, skillDelta: 0 }),
      /venueBaseline は0〜100のパーセントである必要があります/,
    );
  });
}
for (const [rate, expected, n, z] of [
  [70, 50, 100, 4],
  [30, 50, 100, -4],
  [55, 40, 30, 1.68],
  [40, 40, 30, 0],
]) {
  test(`z: rate=${rate}, expected=${expected}, n=${n} の標準誤差と小数2桁`, () => {
    assert.equal(computeZScore({ rate, expected, n }), z);
  });
}
for (const n of [0, -1, NaN, Infinity]) {
  test(`z: 母数${n} はnull`, () => {
    assert.equal(computeZScore({ rate: 70, expected: 50, n }), null);
  });
}
for (const expected of [0, 100]) {
  test(`z: expected=${expected} はnull`, () => {
    assert.equal(computeZScore({ rate: 70, expected, n: 100 }), null);
  });
}
test("小標本: 閾値は20走", () => assert.equal(MIN_RELIABLE_RUNS, 20));
for (const [n, small] of [[19, true], [20, false], [21, false], [0, true],
  [NaN, true], [Infinity, true], [-Infinity, true]]) {
  test(`小標本: n=${n} の20走境界と有限性`, () => {
    assert.equal(isSmallSampleByRuns(n), small);
  });
}
test("確度: 抽出閾値は逃げ70%、まくり25%", () => {
  assert.equal(EXTRACTION_THRESHOLDS.nige, 70);
  assert.equal(EXTRACTION_THRESHOLDS.makuri, 25);
});
for (const [metric, rate, n, expected] of [
  ["nige", 70, 8, false], ["nige", 95, 100, true],
  ["makuri", 25, 100, false], ["makuri", 50, 100, true],
  ["nige", 95, 0, false],
  // n=8で成功数を丸めると、まくりの25%境界を誤って下回る。
  ["makuri", 56, 8, true],
]) {
  test(`確度: ${metric}, rate=${rate}, n=${n} のWilson95%下限`, () => {
    const lower = wilsonLowerBound((rate / 100) * n, n);
    const reference = lower !== null && lower >= EXTRACTION_THRESHOLDS[metric] / 100;
    assert.equal(reference, expected);
    assert.equal(clearsThresholdWithConfidence(metric, rate, n), reference);
  });
}
test("確度: 未知の指標を拒否する", () => {
  assert.throws(() => clearsThresholdWithConfidence("unknown", 70, 8), /未知の指標/);
});
for (const [successes, n, expected] of [[5.6, 8, 36.6], [6, 8, 40.9],
  [0, 8, 0], [8, 8, 67.6], [0, 0, null]]) {
  test(`Wilson: successes=${successes}, n=${n} の下限を%小数1桁にする`, () => {
    const lower = wilsonLowerBound(successes, n);
    const reference = lower === null ? null : Math.round(lower * 1000) / 10;
    assert.equal(reference, expected);
    assert.equal(wilsonLowerPercentFromCount(successes, n), reference);
  });
}

// BOA-1119: 率からの下限と、Wilson下限による小標本判定を固定する。
for (const [rate, n, expected] of [
  [0.7, 8, 0.3661613038101525],
  [0.75, 8, 0.40926987910258916],
  [0.5, 10, 0.2365895936154873],
  [0.25, 10, 0.0809462330106019],
  [0, 10, 0],
  [1, 10, 0.7224598312333834],
]) {
  test(`Wilson率: rate=${rate}, n=${n} の下限と成功数からの計算が一致`, () => {
    const actual = wilsonLowerBoundFromRate(rate, n);
    assert.ok(Math.abs(actual - expected) < 1e-12);
    assert.equal(actual, wilsonLowerBound(rate * n, n));
  });
}
for (const n of [0, -1, NaN, null]) {
  test(`Wilson率: 母数${n} はnull`, () => {
    assert.equal(wilsonLowerBoundFromRate(0.5, n), null);
    assert.equal(wilsonLowerBoundFromRate(0.5, n), wilsonLowerBound(0.5 * n, n));
  });
}
for (const rate of [1.01, -0.01, NaN, null]) {
  test(`Wilson率: rate=${rate} を拒否する`, () => {
    assert.throws(
      () => wilsonLowerBoundFromRate(rate, 10),
      /wilsonLowerBoundFromRate: rate\(.*\) は 0〜1 である必要があります/,
    );
  });
}
for (const [successes, n, referenceRate, expected] of [
  [2.5, 10, 0.25, true], [7, 10, 0.25, false],
  [28, 31, 0.7, false], [5, 10, 0.5, true],
  [500, 1000, 0.5, true], [600, 1000, 0.5, false],
  [3, 10, 0.1077, false], [3, 10, 0.1078, true],
  [0, 10, 0, false], [10, 10, 1, true],
  [0, 0, 0.1, true], [3, null, 0.1, true],
]) {
  test(`Wilson小標本: successes=${successes}, n=${n}, referenceRate=${referenceRate}`, () => {
    assert.equal(isSmallSample(successes, n, referenceRate), expected);
  });
}
test("Wilson小標本: z=1 を渡せる", () => {
  assert.equal(isSmallSample(5, 10, 0.5, 1), true);
  // 0.3 は既定zではtrue、z=1ではfalseになり、引数の転送も確認できる。
  assert.equal(isSmallSample(5, 10, 0.3, 1), false);
});
for (const successes of [-1, 11]) {
  test(`Wilson小標本: successes=${successes} を拒否する`, () => {
    assert.throws(() => isSmallSample(successes, 10, 0.1), /wilsonLowerBound: successes/);
  });
}

// 仕様と一致しない入力・仕様未定の入力は合否判定に使わない。
const KNOWN_GAPS = [
  {
    name: "isSmallSampleのJSDocの下限は約74%だが現在は約75.1%",
    input: { rate: 0.903, n: 31 },
    specification: "JSDocは約74%（閾値70%での判定falseは同じ）。コメントの修正は別起票",
    actual: () => wilsonLowerBound(0.903 * 31, 31),
  },
  {
    name: "nullの率は拒否するが、nullからの成功数は0になる",
    input: { rate: null, n: 10 },
    specification: "2関数でnullの扱いが異なる。統一の仕様は未定",
    actual: () => {
      let fromRate;
      try {
        fromRate = wilsonLowerBoundFromRate(null, 10);
      } catch (error) {
        fromRate = { error: error.message };
      }
      return { fromRate, fromCount: wilsonLowerBound(null * 10, 10) };
    },
  },
  {
    name: "地力の丸め境界での浮動小数誤差",
    input: { rate: 60, expected: 52.35 },
    specification: 7.7,
    actual: () => computeSkillDelta({ rate: 60, expected: 52.35 }),
  },
  {
    name: "nigashi はJSDoc対象外で閾値22の単位もpt",
    input: { metric: "nigashi", rate: 30, n: 50 },
    specification: "未定（率の確度判定にptの閾値を渡す契約はない）",
    actual: () => clearsThresholdWithConfidence("nigashi", 30, 50),
  },
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const { actual, ...gap } of KNOWN_GAPS) {
  let current;
  try {
    current = actual();
  } catch (error) {
    current = { error: error.message };
  }
  console.log(JSON.stringify({ ...gap, actual: current }));
}
console.log(`${cases.length}件中 ${cases.length - failed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
