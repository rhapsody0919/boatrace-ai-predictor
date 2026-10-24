// BOA-1074: 本体の数式・CLI自己試験と、切片付きロジスティックMLEの性質。
import assert from "node:assert/strict";

// CLIのendsWith判定はverifyの名前にも一致する。自己試験の誤起動を防ぎ、
// import後は必ずargvを復元する（子プロセスや本体の書き換えは不要）。
const entry = process.argv[1];
let calibration;
try {
  process.argv[1] = undefined;
  calibration = await import("../lib/parametric-calibration.js");
} finally {
  process.argv[1] = entry;
}
const { solveLinear, PlattCalibrator, BetaCalibrator, OddsAwareCalibrator } = calibration;
const sum = (values) => values.reduce((total, value) => total + value, 0);
function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `expected ${expected} ± ${tolerance}, got ${actual}`);
}
function probability(value) {
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
}
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

// CLIと同じ決定論的な入力。Betaの浮動小数ループも変更しない。
const scores = [], outcomes = [], probs = [], betaOutcomes = [];
for (let s = 10; s <= 90; s += 2) {
  const ones = Math.round(10 / (1 + Math.exp(-(s - 50) / 10)));
  for (let i = 0; i < 10; i++) {
    scores.push(s);
    outcomes.push(i < ones ? 1 : 0);
  }
}
for (let q = 0.05; q <= 0.95; q += 0.05) {
  const ones = Math.round(q * q * 20);
  for (let i = 0; i < 20; i++) {
    probs.push(q);
    betaOutcomes.push(i < ones ? 1 : 0);
  }
}
const oaScores = [], odds = [], oaOutcomes = [];
for (const o of [1.5, 2, 3, 5, 10, 30, 100]) {
  for (let i = 0; i < 200; i++) {
    oaScores.push(50 + (i % 10));
    odds.push(o);
    oaOutcomes.push(i < Math.round(200 / o) ? 1 : 0);
  }
}
// 各試験で独立してfitし、ある試験の失敗後も他の公開物を検証する。
function fitPlatt() {
  const cal = new PlattCalibrator();
  cal.fit(scores, outcomes);
  return cal;
}
function fitBeta() {
  const cal = new BetaCalibrator();
  cal.fit(probs, betaOutcomes);
  return cal;
}
function fitOdds() {
  const cal = new OddsAwareCalibrator();
  cal.fit(oaScores, odds, oaOutcomes);
  return cal;
}
const roundTrip = (Class, cal) => Class.fromJSON(JSON.parse(JSON.stringify(cal.toJSON())));

check("solveLinear: 連立方程式の解", () => {
  const result = solveLinear([[2, 1], [1, 3]], [3, 5]);
  near(result[0], 0.8);
  near(result[1], 1.4);
});
check("solveLinear: 部分ピボット", () => {
  assert.deepEqual(solveLinear([[0, 1], [1, 0]], [2, 3]), [3, 2]);
});
check("solveLinear: 特異行列", () => {
  assert.equal(solveLinear([[1, 2], [2, 4]], [3, 6]), null);
});
check("Platt: 切片MLEの予測合計205", () => {
  assert.equal(sum(outcomes), 205);
  near(sum(fitPlatt().predict(scores)), 205, 1e-6);
});
check("Platt: 非対称の入力で予測の合計が1の数に一致", () => {
  const asymmetricScores = [], asymmetricOutcomes = [];
  for (let s = 0; s <= 100; s += 5) {
    const ones = Math.round(10 / (1 + Math.exp(-(s - 70) / 8)));
    for (let i = 0; i < 10; i++) {
      asymmetricScores.push(s);
      asymmetricOutcomes.push(i < ones ? 1 : 0);
    }
  }
  assert.equal(asymmetricScores.length, 210);
  assert.equal(sum(asymmetricOutcomes), 65);
  const cal = new PlattCalibrator();
  cal.fit(asymmetricScores, asymmetricOutcomes);
  // 切片のスコア方程式。微小な正則化によるずれを許容する。
  near(sum(cal.predict(asymmetricScores)), 65, 1e-4);
});
check("Platt: 傾きのスコア方程式", () => {
  const cal = fitPlatt();
  const { mean, std, w } = cal.toJSON();
  const predictions = cal.predict(scores);
  // 本体のRIDGEが変わったら、正則化項の1e-6も合わせて直す。
  const gradient = sum(scores.map((s, i) =>
    (predictions[i] - outcomes[i]) * (s - mean) / std)) + 1e-6 * w[0];
  near(gradient, 0, 1e-6);
});
check("Platt: 中央・単調・範囲・返却型", () => {
  const cal = fitPlatt();
  near(cal.predict(50), 0.5, 0.05);
  const predictions = cal.predict([20, 50, 80]);
  assert.ok(Array.isArray(predictions));
  assert.equal(typeof cal.predict(50), "number");
  assert.ok(predictions[0] < predictions[1] && predictions[1] < predictions[2]);
  [-1000, 1000].forEach((score) => probability(cal.predict(score)));
});
check("Platt: JSON往復", () => {
  const cal = fitPlatt(), restored = roundTrip(PlattCalibrator, cal);
  [20, 50, 60, 80].forEach((score) => near(restored.predict(score), cal.predict(score)));
});
check("Platt: 未学習・不正な学習入力", () => {
  assert.throws(() => new PlattCalibrator().predict(50), /not been fitted/);
  assert.throws(() => new PlattCalibrator().fit([], []), /non-empty/);
  assert.throws(() => new PlattCalibrator().fit([1], [0, 1]), /equal length/);
});
check("Beta: 切片MLEの予測合計103", () => {
  assert.equal(sum(betaOutcomes), 103);
  near(sum(fitBeta().predict(probs)), 103, 1e-4);
});
check("Beta: 過信の補正・単調・JSON往復", () => {
  const cal = fitBeta(), restored = roundTrip(BetaCalibrator, cal);
  assert.ok(cal.predict(0.5) < 0.35);
  assert.ok(cal.predict(0.9) > cal.predict(0.3));
  [0.3, 0.5, 0.9].forEach((q) => near(restored.predict(q), cal.predict(q)));
});
check("Beta: 恒等写像・端点のクリップ", () => {
  const identity = BetaCalibrator.fromJSON({ type: "beta", w: [1, 1, 0] });
  near(identity.predict(0.3), 0.3);
  near(identity.predict(0), 1e-6);
  near(identity.predict(1), 1 - 1e-6);
  identity.predict([0, 1]).forEach(probability);
});
check("OddsAware: logit市場確率とスコアの特徴量", () => {
  assert.deepEqual(OddsAwareCalibrator._features(55, 2), [0, 55]);
  near(OddsAwareCalibrator._features(42, 10)[0], Math.log(1 / 9));
  assert.equal(OddsAwareCalibrator._features(42, 10)[1], 42);
});
check("OddsAware: EV・単調・JSON往復", () => {
  const cal = fitOdds(), restored = roundTrip(OddsAwareCalibrator, cal);
  for (const o of [2, 10, 100]) {
    const p = cal.predict(55, o);
    probability(p);
    assert.ok(p * o > 0.5 && p * o < 1.6, `odds=${o}, EV=${p * o}`);
    near(restored.predict(55, o), p);
  }
  assert.ok(cal.predict(55, 2) > cal.predict(55, 10));
  assert.ok(cal.predict(55, 10) > cal.predict(55, 100));
  assert.ok(cal.predict(55, 1.5) > cal.predict(55, 100));
});

// 未定義の境界・正則化依存の値は仕様として固定せず、実行時に観測する。
const KNOWN_GAPS = [
  {
    input: { score: 50, odds: [1, 0] },
    specificationValue: "未定（1.01への切り上げはコメントに仕様なし）",
    observe: () => [1, 0].map((o) => OddsAwareCalibrator._features(50, o)),
  },
  {
    input: { scores: [1, 2, 3, 4], outcomes: [0, 0, 1, 1] },
    specificationValue: "完全分離の有限MLEは存在せず、重みはRIDGE・反復上限依存",
    observe: () => {
      const cal = new PlattCalibrator();
      cal.fit([1, 2, 3, 4], [0, 0, 1, 1]);
      return cal.toJSON();
    },
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}`);
for (const { observe, ...gap } of KNOWN_GAPS) {
  try {
    console.log(JSON.stringify({ ...gap, implementationValue: observe() }));
  } catch (error) {
    console.log(JSON.stringify({ ...gap, implementationValue: { error: error.message } }));
  }
}
console.log(`parametric-calibration: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
