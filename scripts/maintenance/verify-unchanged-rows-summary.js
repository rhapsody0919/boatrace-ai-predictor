/** BOA-1088: 書き込み計画とスキップログの純関数を、DB非接続で検証する。 */
import assert from "node:assert/strict";
import {
  normalizeTimestamp,
  planWriteAll,
  formatSkipSummary,
} from "../lib/unchangedRows.js";

let passed = 0;
let failed = 0;
function test(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message.replace(/\n/g, " ")}`);
  }
}

// コメントの「同じ瞬間」をUTCのミリ秒として固定する。
for (const [name, value] of [
  ["UTCオフセット", "2026-09-19T01:34:00+00:00"],
  ["ミリ秒とZ", "2026-09-19T01:34:00.000Z"],
  ["日本時間オフセット", "2026-09-19T10:34:00+09:00"],
  ["Date", new Date("2026-09-19T01:34:00Z")],
]) {
  test(`normalizeTimestamp: 同じ瞬間（${name}）`, () => {
    assert.equal(normalizeTimestamp(value), 1789781640000);
  });
}
for (const [name, value, expected] of [
  ["null", null, null],
  ["undefined", undefined, null],
  ["解釈できない文字列", "abc", "abc"],
  ["空文字列", "", ""],
]) {
  test(`normalizeTimestamp: ${name}`, () => {
    assert.equal(normalizeTimestamp(value), expected);
  });
}

for (const [name, rows] of [
  ["2行", [{ a: 1 }, { a: 2 }]],
  ["空配列", []],
]) {
  test(`planWriteAll: ${name}の計画と配列参照`, () => {
    const result = planWriteAll(rows);
    assert.strictEqual(result.toWrite, rows);
    assert.deepEqual(result, {
      toWrite: rows,
      fallback: false,
      stats: {
        total: rows.length,
        unchanged: 0,
        changed: 0,
        missing: 0,
        toWrite: rows.length,
        changedColumns: {},
      },
    });
  });
}

for (const { name, label, stats, options, expected } of [
  {
    name: "変更列を件数の多い順に表示",
    label: "races",
    stats: { unchanged: 3, toWrite: 2, changedColumns: { b: 1, a: 2 } },
    expected: "races: 変更なし3件スキップ / 書き込み2件（変更のあった列: a×2, b×1）",
  },
  {
    name: "fallbackと変更列省略",
    label: "races",
    stats: { unchanged: 0, toWrite: 5 },
    options: { fallback: true },
    expected: "races: 変更なし0件スキップ / 書き込み5件（既存行を取得できず全件書き込み）",
  },
  {
    name: "空の変更列と書き込み0件",
    label: "x",
    stats: { unchanged: 1, toWrite: 0, changedColumns: {} },
    expected: "x: 変更なし1件スキップ / 書き込み0件",
  },
  {
    name: "変更列は上位5列だけ表示",
    label: "x",
    stats: {
      unchanged: 0,
      toWrite: 6,
      changedColumns: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
    },
    expected: "x: 変更なし0件スキップ / 書き込み6件（変更のあった列: f×6, e×5, d×4, c×3, b×2）",
  },
]) {
  test(`formatSkipSummary: ${name}`, () => {
    assert.equal(formatSkipSummary(label, stats, options), expected);
  });
}

// 仕様と不一致・仕様未定の入力はassertせず、現在の結果を毎回取得する。
function observe(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { exception: { name: error.name, message: error.message } };
  }
}
const KNOWN_GAPS = [
  {
    input: 'normalizeTimestamp(new Date("x"))',
    specification: "解釈できない値は文字列のまま返す（無効なDateの文字列表現は未定）",
    actual: observe(() => normalizeTimestamp(new Date("x"))),
  },
  {
    input: "normalizeTimestamp(0)",
    specification: "未定（数の入力は仕様に無い）",
    actual: observe(() => normalizeTimestamp(0)),
  },
  {
    input: 'formatSkipSummary("x", { unchanged: 0, toWrite: 1, changedColumns: { b: 2, a: 2 } })',
    specification: "未定（同じ件数の列の順序）",
    actual: observe(() => formatSkipSummary("x", {
      unchanged: 0, toWrite: 1, changedColumns: { b: 2, a: 2 },
    })),
  },
];
console.log(`KNOWN_GAPS ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`結果: PASS ${passed}件 / FAIL ${failed}件`);
if (failed > 0) process.exitCode = 1;
