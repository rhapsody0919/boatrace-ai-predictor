#!/usr/bin/env node
/**
 * 日本の暦日（YYYY-MM-DD）を整形する関数が、実行環境のタイムゾーンに依らず同じ日付を出すことを固定する（BOA-1092）。
 *
 * formatDate・formatDateObject は `new Date(dateStr + "T00:00:00+09:00")` をローカル時刻の getDate() で読んでいたため、
 * JST より西（UTC のサーバー・海外のブラウザ）で1日前になっていた（TZ=UTC で 2026-10-25 が「2026年10月24日(土)」。
 * /races の日付カードが、リンク先 /races/2026-10-24 と違う「10/23(金)」を出し、/races/:date の見出し・title も前日だった）。
 * BOA-1086（PR #1877、formatters.js 全体の verify）が JST 以外を KNOWN_GAPS（合否に含めない）に残した件を、ここで仕様として固定する。
 *
 * TZ は process.env.TZ の代入で切り替える（Node は代入でタイムゾーンを読み直す）。ネットワーク・DB は使わない。
 */
import assert from "node:assert/strict";
import { calcAge } from "../../src/components/racer/racerFilterUtils.js";
import {
  formatDate,
  formatDateObject,
  formatDateShort,
} from "../../src/utils/formatters.js";

// 日付変更線の両側と、夏時間のある地域を入れる
const TIMEZONES = [
  "Asia/Tokyo",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Asia/Seoul",
  "Asia/Taipei",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];

// 月末・年末・うるう日・夏時間の切り替わる日（米国 2026-03-08 / 2026-11-01）
const CASES = [
  ["2026-10-25", "2026年10月25日(日)", "10/25(日)", "2026年10月"],
  ["2026-10-01", "2026年10月1日(木)", "10/1(木)", "2026年10月"],
  ["2026-01-01", "2026年1月1日(木)", "1/1(木)", "2026年1月"],
  ["2025-12-31", "2025年12月31日(水)", "12/31(水)", "2025年12月"],
  ["2024-02-29", "2024年2月29日(木)", "2/29(木)", "2024年2月"],
  ["2026-03-08", "2026年3月8日(日)", "3/8(日)", "2026年3月"],
  ["2026-11-01", "2026年11月1日(日)", "11/1(日)", "2026年11月"],
];

let passed = 0;
let failed = 0;

function test(name, run) {
  try {
    run();
    passed++;
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message.replace(/\s+/g, " ")}`);
  }
}

const originalTz = process.env.TZ;
try {
  for (const tz of TIMEZONES) {
    process.env.TZ = tz;
    for (const [input, full, short, yearMonth] of CASES) {
      test(`${tz} formatDate(${input})`, () => {
        assert.equal(formatDate(input), full);
      });
      test(`${tz} formatDateObject(${input})`, () => {
        assert.deepEqual(formatDateObject(input), { full, short, yearMonth });
      });
      test(`${tz} formatDateShort(${input})`, () => {
        assert.equal(formatDateShort(input), short);
      });
    }
  }
  // 変異の確かめ: TZ の切り替えが本当に効いていること（効いていなければ上の試験は何も見ていない）
  process.env.TZ = "America/Los_Angeles";
  test("TZ の切り替えが効いている（LA で JST 0時はローカルの前日）", () => {
    assert.equal(new Date("2026-10-25T00:00:00+09:00").getDate(), 24);
  });
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

// JST の誕生日当日でも、UTC・米国では前日になる時刻で既定の「今日」を検証する。
const RealDate = globalThis.Date;
const fixedNow = RealDate.parse("2026-10-25T00:30:00+09:00");
try {
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }

    static now() {
      return fixedNow;
    }
  };
  for (const tz of TIMEZONES) {
    process.env.TZ = tz;
    for (const [birthDate, expected] of [
      ["1990-10-25", 36],
      ["1990-10-26", 35],
      [null, null],
      ["", null],
    ]) {
      test(`${tz} calcAge(${JSON.stringify(birthDate)})`, () => {
        assert.equal(calcAge(birthDate), expected);
      });
    }
  }
} finally {
  globalThis.Date = RealDate;
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

console.log(`${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exitCode = 1;
