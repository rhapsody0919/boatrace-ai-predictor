#!/usr/bin/env node
// SNS の送り手の共通の時刻の関数（scripts/lib/sns/researchSchedule.js の minutesBefore・addMin・jstTime・jstDate・isIso。2026-11-25 に4ファイルから寄せた）の値
import assert from "node:assert/strict";
import * as time from "../lib/sns/researchSchedule.js";

const { minutesBefore, addMin, jstTime, jstDate, isIso } = time;
assert.equal(minutesBefore("2026-11-25T10:00:00.000Z", 30), "2026-11-25T09:30:00.000Z");
assert.equal(addMin("2026-11-25T10:00:00.000Z", 90), "2026-11-25T11:30:00.000Z");
assert.equal(jstTime("2026-11-25T14:59:00Z"), "23:59", "UTC 14:59 は JST 23:59");
assert.equal(jstTime("2026-11-25T15:00:00Z"), "00:00", "日付をまたぐ");
assert.equal(jstDate(new Date("2026-11-25T14:59:59Z")), "2026-11-25");
assert.equal(jstDate(new Date("2026-11-25T15:00:00Z")), "2026-11-26", "UTC 15:00 で JST の翌日");
assert.equal(isIso("2026-11-25T10:00:00Z"), true);
assert.equal(isIso("2026-11-25T19:00+09:00"), true);
assert.equal(isIso("2026-11-25T10:00:00"), false, "時差の無い文字列は拒む");
assert.equal(isIso("2026-13-45T10:00:00Z"), false, "日付として読めない");
assert.equal(isIso(null), false);

console.log("verify-sns-time: OK");
