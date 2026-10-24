#!/usr/bin/env node
/** BOA-1060: venueParameters.js のコメントの式・分類を固定する。外部接続不要。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getVolatilityThreshold,
  getVenueType,
  VENUE_1COURSE_WIN_RATE,
  VENUE_TYPE,
  VENUE_VOLATILITY_THRESHOLD_DEFAULT,
} from "../lib/venueParameters.js";

// 未定の期待値は assert しない。現行の表に無い入力の仕様を追加しない。
const KNOWN_GAPS = [
  {
    input: "会場の率が0（現行の表には無し）",
    specification: "未定（式だけなら75）",
    current: "!rate により既定の65",
  },
  {
    input: "旧 VENUE_VOLATILITY_THRESHOLD と動的な式の差",
    specification: "未定（旧表は参照用で、一致の仕様は無い）",
    current: "例: 02 は旧表55、動的な式64",
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));

const venueCodes = Array.from({ length: 24 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

test("表のキーは01〜24の24会場ちょうど", () => {
  assert.deepEqual(Object.keys(VENUE_1COURSE_WIN_RATE).sort(), venueCodes);
  assert.deepEqual(Object.keys(VENUE_TYPE).sort(), venueCodes);
});

test("閾値の代表値は01=60・02=64・24=56・18=58", () => {
  for (const [code, expected] of [["01", 60], ["02", 64], ["24", 56], ["18", 58]]) {
    assert.equal(getVolatilityThreshold(code), expected, code);
  }
});

test("24会場の閾値はコメントの式と一致し45〜75の整数", () => {
  for (const [code, rate] of Object.entries(VENUE_1COURSE_WIN_RATE)) {
    const expected = Math.round(Math.max(45, Math.min(75, 60 + (0.53 - rate) * 40)));
    const actual = getVolatilityThreshold(code);
    assert.equal(actual, expected, code);
    assert.ok(Number.isInteger(actual) && actual >= 45 && actual <= 75, code);
  }
});

test("表に無い会場の閾値は既定の65", () => {
  assert.equal(VENUE_VOLATILITY_THRESHOLD_DEFAULT, 65);
  for (const code of ["99", undefined]) {
    assert.equal(getVolatilityThreshold(code), VENUE_VOLATILITY_THRESHOLD_DEFAULT);
  }
});

// 分類の根拠は対象モジュールのJSDoc（的中率を優先し、4会場は率で補完）。
const typeGroups = {
  stable: ["06", "15", "18", "19", "21", "24"],
  volatile: ["03", "05", "07", "09", "10", "11", "12", "13", "16", "17", "20", "22", "23"],
  extreme: ["01", "02", "04", "08", "14"],
};

test("24会場の展開の型はコメントの分類と一致", () => {
  for (const [type, codes] of Object.entries(typeGroups)) {
    for (const code of codes) {
      assert.equal(VENUE_TYPE[code], type, code);
      assert.equal(getVenueType(code), type, code);
    }
  }
  for (const type of Object.values(VENUE_TYPE)) {
    assert.ok(["stable", "volatile", "extreme"].includes(type));
  }
});

test("表に無い会場の展開の型はvolatile", () => {
  assert.equal(getVenueType("99"), "volatile");
});
