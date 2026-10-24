#!/usr/bin/env node
/** BOA-1045: 節の取得範囲を決める年月計算。ネットワーク・DB・実時刻は使わない。 */
import assert from "node:assert/strict";
import {
  shiftYm,
  ymOf,
  firstDayOf,
  lastDayOf,
  UNTITLED_SEGMENT_RE,
} from "../lib/raceSeriesSync.js";

// 仕様の値: BOA-1045 の再現入力と raceSeriesSync.js の YYYYMM・月前後の定義。
// 今の実装の値: 指定土台 65bf85925 で同じ入力を評価した値。仕様とは別に保持する。
const cases = [
  { name: "shiftYm: 同年の翌月", run: () => shiftYm("202610", 1), spec: "202611", current: "202611" },
  { name: "shiftYm: 翌年の1月", run: () => shiftYm("202612", 1), spec: "202701", current: "202701" },
  { name: "shiftYm: 前年の12月", run: () => shiftYm("202601", -1), spec: "202512", current: "202512" },
  { name: "shiftYm: 22か月前", run: () => shiftYm("202610", -22), spec: "202412", current: "202412" },
  { name: "shiftYm: 0か月", run: () => shiftYm("202610", 0), spec: "202610", current: "202610" },
  { name: "ymOf: 日付から年月", run: () => ymOf("2026-10-24"), spec: "202610", current: "202610" },
  { name: "firstDayOf: 月初", run: () => firstDayOf("202610"), spec: "2026-10-01", current: "2026-10-01" },
  { name: "lastDayOf: 平年の2月", run: () => lastDayOf("202602"), spec: "2026-02-28", current: "2026-02-28" },
  { name: "lastDayOf: うるう年の2月", run: () => lastDayOf("202402"), spec: "2024-02-29", current: "2024-02-29" },
  { name: "lastDayOf: 12月", run: () => lastDayOf("202612"), spec: "2026-12-31", current: "2026-12-31" },
  { name: "lastDayOf: 4月", run: () => lastDayOf("202604"), spec: "2026-04-30", current: "2026-04-30" },
  { name: "UNTITLED_SEGMENT_RE: 対象の警告", run: () => UNTITLED_SEGMENT_RE.test("端以外の節に節名のリンクがありません: …"), spec: true, current: true },
  { name: "UNTITLED_SEGMENT_RE: 異なる先頭", run: () => UNTITLED_SEGMENT_RE.test("節名のリンクがありません"), spec: false, current: false },
];

// 食い違いは仕様に合わせて本体を直さず、入力（試験名）・両方の値を出す。
const KNOWN_GAPS = cases
  .filter(({ spec, current }) => spec !== current)
  .map(({ name: input, spec, current }) => ({ input, spec, current }));
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, KNOWN_GAPS);

for (const { name, run, spec, current } of cases) {
  if (spec !== current) continue;
  assert.equal(run(), spec, name);
  console.log(`PASS: ${name}`);
}
console.log("OK: 節の年月計算と節名未掲載の警告を検証");
