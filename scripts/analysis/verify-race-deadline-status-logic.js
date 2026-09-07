/**
 * getDeadlineStatus() / getDeadlineDate() の判定ロジックを検証する（BOA-243）。
 * 単体テストフレームワークが無いため、既存のverify-*.jsパターンに準拠した
 * assertベースの検証スクリプトとして実装する（BOA-255参照）。
 *
 * 実行: node scripts/analysis/verify-race-deadline-status-logic.js
 */

import assert from "node:assert/strict";
import {
  getDeadlineDate,
  getDeadlineStatus,
  DEADLINE_STATUS,
} from "../../src/utils/raceDeadlineStatus.js";

let passed = 0;

function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  passed++;
  console.log(`  ✅ ${label}`);
}

console.log("raceDeadlineStatus 検証開始\n");

const RACE_ID = "2026-09-06-12-01"; // 住之江 1R
const START_TIME = "10:30";
const DEADLINE = getDeadlineDate(RACE_ID, START_TIME);

assert.equal(DEADLINE.toISOString(), new Date("2026-09-06T10:30:00+09:00").toISOString());
console.log("  ✅ getDeadlineDate() がJST固定でDateを構築する");
passed++;

// 5分1秒前: ACCEPTING（境界の外側）
check(
  "締切5分1秒前はACCEPTING",
  getDeadlineStatus(RACE_ID, START_TIME, new Date(DEADLINE.getTime() - 5 * 60 * 1000 - 1000)),
  DEADLINE_STATUS.ACCEPTING,
);

// ちょうど5分前: CLOSING_SOON（境界含む）
check(
  "締切ちょうど5分前はCLOSING_SOON",
  getDeadlineStatus(RACE_ID, START_TIME, new Date(DEADLINE.getTime() - 5 * 60 * 1000)),
  DEADLINE_STATUS.CLOSING_SOON,
);

// 1秒前: CLOSING_SOON
check(
  "締切1秒前はCLOSING_SOON",
  getDeadlineStatus(RACE_ID, START_TIME, new Date(DEADLINE.getTime() - 1000)),
  DEADLINE_STATUS.CLOSING_SOON,
);

// ちょうど0秒: CLOSED
check(
  "締切ちょうど0秒はCLOSED",
  getDeadlineStatus(RACE_ID, START_TIME, new Date(DEADLINE.getTime())),
  DEADLINE_STATUS.CLOSED,
);

// 締切後: CLOSED
check(
  "締切1秒後はCLOSED",
  getDeadlineStatus(RACE_ID, START_TIME, new Date(DEADLINE.getTime() + 1000)),
  DEADLINE_STATUS.CLOSED,
);

// 不正なraceId: null
check(
  "raceId形式が不正な場合はnull",
  getDeadlineStatus("invalid-id", START_TIME, new Date()),
  null,
);

// startTime未指定: null
check("startTimeが無い場合はnull", getDeadlineStatus(RACE_ID, null, new Date()), null);

// 日付またぎダミーケース: 大晦日開催の23:55発走が翌日にまたがらないことを確認
const NYE_RACE_ID = "2026-12-31-01-12";
const NYE_START = "23:55";
const nyeDeadline = getDeadlineDate(NYE_RACE_ID, NYE_START);
assert.equal(nyeDeadline.toISOString(), new Date("2026-12-31T23:55:00+09:00").toISOString());
console.log("  ✅ 大晦日23:55発走でも年またぎせず同日の日付で締切を構築する");
passed++;

console.log(`\n✅ 全${passed}件のケースが期待通りでした`);
