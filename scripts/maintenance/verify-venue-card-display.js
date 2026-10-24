#!/usr/bin/env node
/**
 * BOA-1036: 会場カードの時間帯と、人・ボット共通の表示値を固定する。
 * 仕様の根拠: raceTimeOfDay.js の境界コメント、raceListDisplay.js の JSDoc、
 * gradeConfig.js、ADR 0089 決定3。外部通信・時計・ブラウザは使わない。
 */
import assert from "node:assert/strict";
import { getTimeOfDay, getVenueTimeOfDay } from "../../src/utils/raceTimeOfDay.js";
import {
  venueCardHeadline,
  gradeConfigOf,
  raceNumberLabel,
  deadlineValueText,
  venueNameOf,
} from "../../src/utils/raceListDisplay.js";

// 各行は [入力, 仕様の値, 指定SHAで確認した今の実装の値]。
// 今の実装の値はリテラルで保持し、実行結果から期待値を作らない。
// 食い違いが見つかった入力は assert の表から外し、ここへ記録する。
// 形式: { name, input, specificationValue, implementationValue }
const KNOWN_GAPS = [];
const failures = [];
let checked = 0;

function check(name, actual, specificationValue, implementationValue) {
  checked += 1;
  try {
    assert.deepStrictEqual(specificationValue, implementationValue);
    assert.deepStrictEqual(actual, specificationValue);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

const timeCases = [
  ["08:30", "morning", "morning"],
  ["9:30", "morning", "morning"],
  ["09:31", "day", "day"],
  ["11:15", "day", "day"],
  ["11:16", "summer", "summer"],
  ["14:00", "summer", "summer"],
  ["14:01", "nighter", "nighter"],
  ["16:30", "nighter", "nighter"],
  ["16:31", "midnight", "midnight"],
  ["24:00", "midnight", "midnight"],
  ["8:3", null, null],
  ["", null, null],
  [null, null, null],
  [930, null, null],
];
for (const [input, specificationValue, implementationValue] of timeCases) {
  check(`getTimeOfDay(${JSON.stringify(input)})`, getTimeOfDay(input),
    specificationValue, implementationValue);
}

// 後ろの1Rと先頭の2Rで時間帯を変え、先頭行採用の変異も検出する。
const venueCases = [
  ["依頼のraceNo例", [
    { raceNo: 2, startTime: "15:00" }, { raceNo: 1, startTime: "14:57" },
  ], "nighter", "nighter"],
  ["raceNoの最小番号", [
    { raceNo: 2, startTime: "08:30" }, { raceNo: 1, startTime: "14:57" },
  ], "nighter", "nighter"],
  ["raceNumberの最小番号", [
    { raceNumber: 2, startTime: "08:30" }, { raceNumber: 1, startTime: "14:57" },
  ], "nighter", "nighter"],
  ["番号なしは99扱い", [
    { startTime: "08:30" }, { raceNo: 1, startTime: "14:57" },
  ], "nighter", "nighter"],
  ["空配列", [], null, null],
  ["null", null, null, null],
];
for (const [name, input, specificationValue, implementationValue] of venueCases) {
  check(`getVenueTimeOfDay: ${name}`, getVenueTimeOfDay(input),
    specificationValue, implementationValue);
}

// 仕様の値と今の実装の値を別々に記録する。
const headlineCases = [
  ["SG", [{ raceGrade: "SG", raceTitle: "X" }],
    { gradeConfig: { label: "SG", color: "#7c3aed" }, raceTitle: "X" },
    { gradeConfig: { label: "SG", color: "#7c3aed" }, raceTitle: "X" }],
  ["空配列", [],
    { gradeConfig: null, raceTitle: null }, { gradeConfig: null, raceTitle: null }],
  ["空タイトル", [{ raceGrade: "SG", raceTitle: "" }],
    { gradeConfig: { label: "SG", color: "#7c3aed" }, raceTitle: null },
    { gradeConfig: { label: "SG", color: "#7c3aed" }, raceTitle: null }],
  ["先頭レースの代表値", [
    { raceGrade: "一般", raceTitle: "先頭" }, { raceGrade: "SG", raceTitle: "後続" },
  ], { gradeConfig: null, raceTitle: "先頭" }, { gradeConfig: null, raceTitle: "先頭" }],
];
for (const [name, input, specificationValue, implementationValue] of headlineCases) {
  check(`venueCardHeadline: ${name}`, venueCardHeadline(input),
    specificationValue, implementationValue);
}

const gradeCases = [
  ["SG", { label: "SG", color: "#7c3aed" }, { label: "SG", color: "#7c3aed" }],
  ["G1", { label: "G1", color: "#dc2626" }, { label: "G1", color: "#dc2626" }],
  ["G2", { label: "G2", color: "#2563eb" }, { label: "G2", color: "#2563eb" }],
  ["G3", { label: "G3", color: "#047857" }, { label: "G3", color: "#047857" }],
  ["一般", null, null],
  [null, null, null],
];
for (const [input, specificationValue, implementationValue] of gradeCases) {
  check(`gradeConfigOf(${JSON.stringify(input)})`, gradeConfigOf(input),
    specificationValue, implementationValue);
}

const t = (key) => key === "home.jstNote" ? " (JST)" : `[${key}]`;
check("raceNumberLabel(9)", raceNumberLabel(9), "9R", "9R");
check("deadlineValueText: 注記を連結", deadlineValueText(t, "15:20"),
  "15:20 (JST)", "15:20 (JST)");
check("venueNameOf: 0埋めコードを保持", venueNameOf(t, "06"),
  "[venues.06]", "[venues.06]");

console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length} 件`, JSON.stringify(KNOWN_GAPS));
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(`verify-venue-card-display: ${failures.length}/${checked} 件失敗`);
  process.exit(1);
}
console.log(`verify-venue-card-display: ${checked} 件すべて通過`);
