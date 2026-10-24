/**
 * BOA-1089: 今節の走の着・着順点・色と、表の境目の同点を固定する。
 * 期待値は assistSummary.js のコメントと依頼の仕様値。配点定数は読み込まない。
 * 実行: node scripts/maintenance/verify-assist-run-points.js
 */
import assert from "node:assert/strict";
import {
  finishOf,
  runPoints,
  finishClass,
  tiesBeyond,
} from "../../src/utils/assistSummary.js";

let passed = 0;
let failed = 0;
function test(name, check) {
  try {
    check();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${JSON.stringify(error.message)}`);
  }
}

// 艇番3を各着の列に置く。艇番と着順を取り違えない入力にする。
const runOf = (finish = null) => ({
  boatNumber: 3,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((rank) => [
      `rank${rank}`,
      rank === finish ? 3 : null,
    ]),
  ),
});

for (const [finish, points] of [[1, 10], [2, 8], [3, 6], [4, 4], [5, 2], [6, 1]]) {
  test(`finishOf: ${finish}着`, () => {
    assert.equal(finishOf(runOf(finish)), finish);
  });
  test(`runPoints: 過去の${finish}着は${points}点`, () => {
    assert.equal(runPoints(runOf(finish), false), points);
  });
  test(`runPoints: 今日の${finish}着はnull`, () => {
    assert.equal(runPoints(runOf(finish), true), null);
  });
}
for (const mark of [null, "F", "L", "失", "転"]) {
  const run = { ...runOf(), finishMark: mark };
  test(`finishOf: 着なし(${mark})はnull`, () => {
    assert.equal(finishOf(run), null);
  });
  test(`runPoints: 過去の着なし(${mark})は0点`, () => {
    assert.equal(runPoints(run, false), 0);
  });
}
const absent = { ...runOf(), absent: true };
test("finishOf: 欠場はnull", () => {
  assert.equal(finishOf(absent), null);
});
test("runPoints: 過去の欠場はnull", () => {
  assert.equal(runPoints(absent, false), null);
});
test("runPoints: 今日の欠場はnull", () => {
  assert.equal(runPoints(absent, true), null);
});
test("runPoints: 今日の着なしはnull", () => {
  assert.equal(runPoints(runOf(), true), null);
});

for (const [finish, css] of [
  [1, " ta-fin-1"], [5, " ta-fin-bad"], [6, " ta-fin-bad"],
  [2, ""], [3, ""], [4, ""], [null, ""], [undefined, ""],
]) {
  test(`finishClass: ${finish}のクラス`, () => {
    assert.equal(finishClass(finish), css);
  });
}

const rows = [["a", 5], ["b", 4], ["c", 3], ["d", 3], ["e", 3], ["f", 2]];
for (const [name, input, limit, expected] of [
  ["3位の後ろの同点2行", rows, 3, { n: 2, k: 3 }],
  ["後ろに同点なし", [["a", 5], ["b", 4], ["c", 3], ["d", 2]], 3, null],
  ["limit番目なし", [["a", 5]], 3, null],
  ["空の表", [], 1, null],
  ["1位の後ろの同点1行", [["a", 5], ["b", 5]], 1, { n: 1, k: 5 }],
  ["0件の同点", [["a", 0], ["b", 0]], 1, { n: 1, k: 0 }],
]) {
  test(`tiesBeyond: ${name}`, () => {
    assert.deepEqual(tiesBeyond(input, limit), expected);
  });
}

// 未定義の入力は回帰の期待値にしない。例外も実行時の観測として残す。
function observe(call) {
  try {
    return call();
  } catch (error) {
    return { exception: error.name, message: error.message };
  }
}
const contradictoryRun = { ...runOf(2), absent: true };
const KNOWN_GAPS = [
  {
    name: "runPoints: 着と欠場が併存",
    input: { run: contradictoryRun, today: false },
    specification: "未定",
    actual: observe(() => runPoints(contradictoryRun, false)),
  },
  {
    name: "tiesBeyond: limit=0",
    input: { rows, limit: 0 },
    specification: "未定",
    actual: observe(() => tiesBeyond(rows, 0)),
  },
];
console.log(`KNOWN_GAPS ${KNOWN_GAPS.length}: ${JSON.stringify(KNOWN_GAPS)}`);
console.log(`結果: PASS ${passed} / FAIL ${failed}`);
if (failed > 0) process.exitCode = 1;
