/** BOA-1065: 例外文言と締切判定の公開仕様を、通信・実時刻なしで検証する。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessageOf } from "../../src/utils/errorMessage.js";
import {
  DEADLINE_STATUS,
  getDeadlineDate,
  getDeadlineStatus,
} from "../../src/utils/raceDeadlineStatus.js";

const RACE_ID = "2026-10-25-01-01";

// HH:MM 以外の許容範囲はコメントに定義がないため、現在値を仕様として固定しない。
const KNOWN_GAPS = [
  {
    input: { raceId: RACE_ID, startTime: "9:05" },
    specification: "未定（1桁の時を許すかは HH:MM のコメントに記載なし）",
    current: getDeadlineDate(RACE_ID, "9:05"),
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件\n${JSON.stringify(KNOWN_GAPS, null, 2)}`);

// 根拠: errorMessage.js JSDoc（BOA-668）。有効な文言は保持し、空は必ず補う。
for (const [name, input, expected] of [
  ["文字列", "x", "x"],
  ["Error", new Error("boom"), "boom"],
  ["message オブジェクト", { message: "message" }, "message"],
  ["前後の空白を保持", " x ", " x "],
  ["空文字", "", "Unknown error"],
  ["空白の message", { message: "  " }, "Unknown error"],
  ["空の Error", new Error(""), "Unknown error"],
  ["空オブジェクト", {}, "Unknown error"],
  ["null", null, "Unknown error"],
  ["undefined", undefined, "Unknown error"],
  ["文字列でない message", { message: 42 }, "Unknown error"],
]) {
  test(`errorMessageOf: ${name}`, () => {
    const actual = errorMessageOf(input);
    assert.equal(actual, expected);
    assert.equal(typeof actual, "string");
    assert.ok(actual.trim().length > 0);
  });
}

// 根拠: raceDeadlineStatus.js JSDoc と ADR 0042（レース日付・JST固定）。
test("getDeadlineDate: JST 10:30 を UTC 01:30 に変換", () => {
  assert.equal(getDeadlineDate(RACE_ID, "10:30").toISOString(), "2026-10-25T01:30:00.000Z");
});
test("getDeadlineDate: JST 深夜は前日の UTC", () => {
  assert.equal(getDeadlineDate(RACE_ID, "00:05").toISOString(), "2026-10-24T15:05:00.000Z");
});
for (const [name, raceId, startTime] of [
  ["不正 raceId", "bad", "10:30"],
  ["空 startTime", RACE_ID, ""],
  ["不正な日時", RACE_ID, "25:99"],
]) {
  test(`getDeadlineDate: ${name} は null`, () => {
    assert.equal(getDeadlineDate(raceId, startTime), null);
  });
}

// 根拠: docs/design/race-deadline-status/spec.md FR1/FR2、BOA-1065 の境界値。
test("DEADLINE_STATUS: 公開する3状態", () => {
  assert.deepEqual(DEADLINE_STATUS, {
    ACCEPTING: "accepting",
    CLOSING_SOON: "closing_soon",
    CLOSED: "closed",
  });
});
for (const [time, expected] of [
  ["10:24:59", "accepting"],
  ["10:25:00", "closing_soon"],
  ["10:29:59", "closing_soon"],
  ["10:30:00", "closed"],
  ["10:31:00", "closed"],
]) {
  test(`getDeadlineStatus: ${time} JST は ${expected}`, () => {
    const now = new Date(`2026-10-25T${time}+09:00`);
    assert.equal(getDeadlineStatus(RACE_ID, "10:30", now), expected);
  });
}
test("getDeadlineStatus: 不正 raceId は null", () => {
  assert.equal(getDeadlineStatus("bad", "10:30", new Date("2026-10-25T10:25:00+09:00")), null);
});
