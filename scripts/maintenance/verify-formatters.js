#!/usr/bin/env node
/**
 * 日付・割合の仕様を固定する（BOA-1086）。ネットワーク・DB・実時刻は使わない。
 * JSDoc、formatDateShort のコメント、ADR 0089 と一致する入力だけ assert する。
 * 不一致・仕様未定の入力は KNOWN_GAPS に実行時の値を残し、合否に含めない。
 */
import assert from "node:assert/strict";
import {
  formatExhibitionSt,
  formatPercent,
  formatDate,
  formatDateLocalized,
  formatDateShort,
  formatDateLongLocalized,
  formatDateObject,
  formatCapturedAtJst,
} from "../../src/utils/formatters.js";

let passed = 0;
let failed = 0;
const KNOWN_GAPS = [];

function test(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message.replace(/\s+/g, " ")}`);
  }
}

function recordGap(input, specification, run) {
  let current;
  try {
    current = run();
  } catch (error) {
    current = { exception: error.name, message: error.message };
  }
  KNOWN_GAPS.push({ tz: process.env.TZ, input, specification, current });
}

// 展示ST はタイムゾーンに依存しないため、3タイムゾーンのループ外で検査する。
for (const [input, value, flag, expected] of [
  ["0.15, null", 0.15, null, "0.15"],
  ["0.15, undefined", 0.15, undefined, "0.15"],
  ["0.05, null", 0.05, null, "0.05"],
  ["0.1, null", 0.1, null, "0.10"],
  ["0, null", 0, null, "0.00"],
  ['"0.12", null', "0.12", null, "0.12"],
  ["1.05, null", 1.05, null, "1.05"],
  ['0.01, "F"', 0.01, "F", "F.01"],
  ['0.15, "F"', 0.15, "F", "F.15"],
  ['1.05, "F"', 1.05, "F", "F1.05"],
  ['null, "L"', null, "L", "L"],
  ['undefined, "L"', undefined, "L", "L"],
  ['"", "L"', "", "L", "L"],
  ['0.15, ""', 0.15, "", "0.15"],
  ["null, null", null, null, null],
  ["undefined, undefined", undefined, undefined, null],
  ['"", null', "", null, null],
  ["NaN, null", NaN, null, null],
  ['"abc", null', "abc", null, null],
  ["Infinity, null", Infinity, null, null],
]) {
  test(`formatExhibitionSt(${input}) 展示STの表記`, () => {
    assert.equal(formatExhibitionSt(value, flag), expected);
  });
}

recordGap('formatExhibitionSt(0.15, "X")', "未定（F・L 以外の印）", () =>
  formatExhibitionSt(0.15, "X"),
);
recordGap('formatExhibitionSt(NaN, "F")', "未定（非数値と印）", () =>
  formatExhibitionSt(NaN, "F"),
);
recordGap("formatExhibitionSt(-0.01, null)", "未定（正の数というDBの前提の範囲外）", () =>
  formatExhibitionSt(-0.01, null),
);
recordGap("formatExhibitionSt(0.015, null)", "未定（toFixed の2進の丸め）", () =>
  formatExhibitionSt(0.015, null),
);

const originalTz = process.env.TZ;
try {
  for (const tz of ["Asia/Tokyo", "UTC", "America/Los_Angeles"]) {
    process.env.TZ = tz;
    for (const [input, expected] of [
      [0.755, "75.5%"],
      [0, "0.0%"],
      [1, "100.0%"],
      [0.12345, "12.3%"],
    ]) {
      test(`${tz} formatPercent(${input}) 小数1桁`, () => {
        assert.equal(formatPercent(input), expected);
      });
    }

    // 日本の暦日は実行環境のタイムゾーンに依らない（BOA-1092 で直した。以前は UTC・LA で1日前になり KNOWN_GAPS に残していた）
    for (const [input, expected] of [
      ["2026-10-25", "2026年10月25日(日)"],
      ["2026-01-01", "2026年1月1日(木)"],
      ["2024-02-29", "2024年2月29日(木)"],
    ]) {
      test(`${tz} formatDate(${input}) 年月日と曜日`, () => {
        assert.equal(formatDate(input), expected);
      });
    }
    test(`${tz} formatDateObject(2026-01-01) 3形式とキー`, () => {
      assert.deepEqual(formatDateObject("2026-01-01"), {
        full: "2026年1月1日(木)",
        short: "1/1(木)",
        yearMonth: "2026年1月",
      });
    });

    for (const [input, expected] of [
      ["2026-10-25", "10/25(日)"],
      ["2024-02-29", "2/29(木)"],
      ["2026-01-01", "1/1(木)"],
    ]) {
      test(`${tz} formatDateShort(${input}) 日付と曜日`, () => {
        assert.equal(formatDateShort(input), expected);
      });
    }

    for (const [lang, full, long] of [
      ["ja", "2026年10月25日(日)", "2026年10月25日"],
      ["en", "Sun, October 25, 2026", "October 25, 2026"],
      ["xx", "2026年10月25日(日)", "2026年10月25日"],
    ]) {
      test(`${tz} formatDateLocalized(2026-10-25, ${lang})`, () => {
        assert.equal(formatDateLocalized("2026-10-25", lang), full);
      });
      test(`${tz} formatDateLongLocalized(2026-10-25, ${lang})`, () => {
        assert.equal(formatDateLongLocalized("2026-10-25", lang), long);
      });
    }

    for (const [input, expected] of [
      ["2026-09-18T06:42:00Z", "9/18 15:42"],
      ["2026-09-18T15:05:00Z", "9/19 00:05"],
      ["2026-12-31T15:00:00Z", "1/1 00:00"],
      ["2026-09-18T15:42:00+09:00", "9/18 15:42"],
      [null, null],
      ["", null],
      ["abc", null],
    ]) {
      test(`${tz} formatCapturedAtJst(${JSON.stringify(input)}) JST取得時刻`, () => {
        assert.equal(formatCapturedAtJst(input), expected);
      });
    }
  }
  process.env.TZ = "Asia/Tokyo";
  recordGap("formatPercent(null)", "未定（JSDoc の number 型の範囲外）", () =>
    formatPercent(null),
  );
  recordGap("formatPercent(NaN)", "未定（0〜1 の割合の範囲外）", () =>
    formatPercent(NaN),
  );
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

console.log(`KNOWN_GAPS ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
