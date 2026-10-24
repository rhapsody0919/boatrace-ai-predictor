/** BOA-1068: FR-E の割合・向きと spec B-8 の吹き出しを固定する。 */
import assert from "node:assert/strict";
import { to100, directionText } from "../../src/utils/analogyOutlook.js";
import { boatTip } from "../../src/utils/analogyTips.js";
import { wilsonInterval } from "../../src/utils/wilson.js";

const t = (key, opts) => key + (opts ? JSON.stringify(opts) : "");
const root = "aiPredictionTab.analogy";
const outlook = `${root}.outlook`;
const separator = `${root}.listSeparator`;
let failures = 0;
const test = (name, run) => {
  try {
    run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    failures += 1;
  }
};

// 負数の扱いは to100 のコメントに定義が無い。仕様を推測して assert しない。
const KNOWN_GAPS = [
  {
    input: { function: "boatTip", boat: 4, hits: 1, n: 14, extras: [] },
    specification: "spec B-8 の例は上限32%。依頼のWilson計算・丸め規則では31%",
    current: boatTip(t, 4, 1, 14, []),
  },
  {
    input: { function: "to100", values: [-1, 2] },
    specification: "未定（負数入力の扱い）",
    current: to100([-1, 2]),
  },
  {
    input: { function: "directionText", group: "round", up: ["yosen", "zzz"], down: [] },
    specification: "未定（ROUND_ORDER に無い値の位置）",
    current: directionText("round", { up: ["yosen", "zzz"], down: [] }, t),
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}`, JSON.stringify(KNOWN_GAPS));

test("to100: 最大剰余法と同率時の入力順", () => {
  for (const [input, expected] of [
    [[1, 1, 1], [34, 33, 33]],
    [[2, 1, 1], [50, 25, 25]],
    [[1, 2, 3], [17, 33, 50]],
    [[3, 2, 1], [50, 33, 17]],
    [[0, 1, 0], [0, 100, 0]],
    [[1], [100]],
  ]) {
    const before = [...input];
    const actual = to100(input);
    assert.deepEqual(actual, expected);
    assert.ok(actual.every(Number.isInteger));
    assert.equal(actual.reduce((sum, value) => sum + value, 0), 100);
    assert.deepEqual(input, before);
  }
});

test("to100: 全部0と空配列", () => {
  assert.deepEqual(to100([0, 0]), [0, 0]);
  assert.deepEqual(to100([]), []);
});

test("directionText: 欠落と文字列の向き", () => {
  assert.equal(directionText("grade", undefined, t), null);
  assert.equal(directionText("grade", null, t), null);
  for (const direction of ["none", "varies"]) {
    assert.equal(directionText("grade", direction, t), `${outlook}.dir.${direction}`);
  }
  for (const direction of ["higher", "lower"]) {
    assert.equal(directionText("grade", direction, t), `${outlook}.dir.${direction}.grade`);
  }
  assert.equal(
    directionText("age", "middle", t),
    t(`${outlook}.dir.middle.age`, { defaultValue: `${outlook}.dir.middle.other` }),
  );
});

test("directionText: グレード順と空欄", () => {
  const direction = { up: ["G1", "SG"], down: [] };
  assert.equal(directionText("grade", direction, t), t(`${outlook}.dir.category`, {
    up: `${root}.grades.SG"SG"${separator}${root}.grades.G1"G1"`,
    down: "—",
  }));
  assert.deepEqual(direction, { up: ["G1", "SG"], down: [] });
  assert.equal(directionText("grade", {}, t), t(`${outlook}.dir.category`, {
    up: "—", down: "—",
  }));
});

test("directionText: ラウンド順と空欄", () => {
  const direction = { up: ["other", "yusho", "yosen", "junyu"], down: [] };
  const roundOrder = ["yosen", "junyu", "yusho", "other"];
  assert.equal(directionText("round", direction, t), t(`${outlook}.dir.category`, {
    up: roundOrder.map((value) => t(`${outlook}.roundNames.${value}`, value))
      .join(t(separator)),
    down: "—",
  }));
  assert.deepEqual(direction, { up: ["other", "yusho", "yosen", "junyu"], down: [] });
});

test("boatTip: 母数0はぶれ幅0で割合なし", () => {
  assert.equal(boatTip(t, 2, 0, 0, []), t(`${root}.similar.tip`, {
    boat: 2, n: "0", hits: "0", pct: "—", lo: 0, hi: 0,
  }));
});

test("boatTip: 14件中1件の割合とWilson区間", () => {
  const interval = wilsonInterval(1, 14).map((value) => Math.round(value * 100));
  // Wilson の数学的な値の丸めを固定（spec B-8 の例との差は KNOWN_GAPS）。
  assert.deepEqual(interval, [1, 31]);
  assert.equal(boatTip(t, 4, 1, 14, []), t(`${root}.similar.tip`, {
    boat: 4, n: "14", hits: "1", pct: "7%", lo: 1, hi: 31,
  }));
});

test("boatTip: 追加文は句点と翻訳の区切りで接続", () => {
  const base = t(`${root}.similar.tip`, {
    boat: 4, n: "14", hits: "1", pct: "7%", lo: 1, hi: 31,
  });
  assert.equal(boatTip(t, 4, 1, 14, ["全国10%"]), `${base}。全国10%`);
  assert.equal(boatTip(t, 4, 1, 14, ["全国10%", "比較13%"]),
    `${base}。全国10%${separator}比較13%`);
});

if (failures > 0) process.exitCode = 1;
