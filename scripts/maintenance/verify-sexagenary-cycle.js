/**
 * 六十干支の日柱の契約（BOA-1044）。ネットワーク・DB・実時刻を使わない。
 * 仕様の値: sexagenaryCycle.js 冒頭コメントの4点と、基準日の前日。
 * 今の実装の値: 指定された土台 65bf85925 で照合済み。全5点が仕様と一致。
 * 不一致は KNOWN_GAPS に固定の入力・仕様値・実装値を記録して報告する。
 * 実行結果から除外対象を自動生成しない（将来の回帰を見逃さないため）。
 */
import assert from "node:assert/strict";
import {
  getDayGanzhiIndex,
  getGanzhiLabel,
  STEMS,
  BRANCHES,
} from "../lib/fortuneTelling/sexagenaryCycle.js";

const KNOWN_GAPS = [];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, JSON.stringify(KNOWN_GAPS));

const SPEC_VALUES = [
  { input: "2007-01-01", index: 31, label: "乙未" },
  { input: "1873-01-12", index: 0, label: "甲子" },
  { input: "2008-02-06", index: 12, label: "丙子" },
  { input: "2008-10-05", index: 14, label: "戊寅" },
  { input: "2006-12-31", index: 30, label: "甲午" },
];

let failures = 0;
function test(name, run) {
  try {
    run();
    console.log(`✅ ${name}`);
  } catch (error) {
    failures++;
    console.error(`❌ ${name}: ${error.message}`);
  }
}

for (const { input, index, label } of SPEC_VALUES) {
  test(`基準日: ${input} → ${index}・${label}`, () => {
    const actualIndex = getDayGanzhiIndex(input);
    assert.equal(actualIndex, index);
    assert.equal(getGanzhiLabel(actualIndex), label);
  });
}

test("干支の端点と十干・十二支の個数", () => {
  assert.equal(getGanzhiLabel(0), "甲子");
  assert.equal(getGanzhiLabel(59), "癸亥");
  assert.equal(STEMS.length, 10);
  assert.equal(BRANCHES.length, 12);
});

const DAY_MS = 86400000;
const START_UTC = Date.UTC(2026, 0, 1);
const END_UTC = Date.UTC(2028, 0, 1);
// 引数付き Date と UTC の日付だけを使い、ローカル時刻・実時刻を参照しない。
const dateString = (utc) => new Date(utc).toISOString().slice(0, 10);

test("2年分の毎日: 0〜59の整数で翌日は(index+1) mod 60", () => {
  for (let utc = START_UTC; utc < END_UTC; utc += DAY_MS) {
    const input = dateString(utc);
    const index = getDayGanzhiIndex(input);
    assert.ok(Number.isInteger(index) && index >= 0 && index < 60, input);
    assert.equal(
      getDayGanzhiIndex(dateString(utc + DAY_MS)),
      (index + 1) % 60,
      input,
    );
  }
});

test("2年分の毎日: 60日後は同じindex", () => {
  for (let utc = START_UTC; utc < END_UTC; utc += DAY_MS) {
    const input = dateString(utc);
    assert.equal(
      getDayGanzhiIndex(dateString(utc + 60 * DAY_MS)),
      getDayGanzhiIndex(input),
      input,
    );
  }
});

if (failures > 0) process.exitCode = 1;
