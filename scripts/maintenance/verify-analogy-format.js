/** BOA-1087: 類似レースの表記をコメントと日本語文言で固定する（通信不要）。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fmtPct, fmtCount, venueLabel, comboLabel, fmtFactValue, factRankText,
} from "../../src/utils/analogyFormat.js";

const ja = JSON.parse(fs.readFileSync(
  new URL("../../src/locales/ja/common.json", import.meta.url), "utf8",
));
// verify-analogy-facts.js と同じ翻訳・補間・既定値の扱い。
const t = (key, opts = {}) => {
  const v = key.split(".").reduce((o, k) => o?.[k], ja);
  if (typeof v !== "string") return typeof opts === "string" ? opts : key;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
};
let total = 0;
let failures = 0;
function check(name, run, expected) {
  total += 1;
  try {
    assert.deepStrictEqual(run(), expected);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message.replace(/\n/g, " ")}`);
  }
}
// 期待値は仕様からの定数。丸め境界は避ける。
for (const [name, args, expected] of [
  ["整数桁", [0.655], "66%"],
  ["小数1桁", [0.655, 1], "65.5%"],
  ["0", [0], "0%"], ["1", [1], "100%"],
  ["null", [null], "—"], ["undefined", [undefined], "—"],
  ["NaN", [NaN], "—"], ["Infinity", [Infinity], "—"],
]) check(`fmtPct ${name}`, () => fmtPct(...args), expected);
for (const [name, value, expected] of [
  ["千区切り", 1134, "1,134"], ["0", 0, "0"],
  ["百万", 1234567, "1,234,567"], ["数値文字列", "1500", "1,500"],
  ["null", null, "—"], ["undefined", undefined, "—"],
]) check(`fmtCount ${name}`, () => fmtCount(value), expected);
for (const [code, expected] of [[1, "桐生"], ["04", "平和島"], [24, "大村"], [25, "25"]]) {
  check(`venueLabel ${code}`, () => venueLabel(code, t), expected);
  // 翻訳が無い場合の日本語の会場名も直接通す。
  check(`venueLabel 既定値 ${code}`, () => venueLabel(code, (_key, fallback) => fallback), expected);
}
for (const [combo, text, uniform] of [
  [[6, 0, 0, 0], "6艇ともA1", true],
  [[0, 6, 0, 0], "6艇ともA2", true],
  [[0, 0, 6, 0], "6艇ともB1", true],
  [[0, 0, 0, 6], "6艇ともB2", true],
  [[2, 1, 3, 0], "A1が2艇・A2が1艇・B1が3艇", false],
  [[1, 1, 2, 2], "A1が1艇・A2が1艇・B1が2艇・B2が2艇", false],
  [[0, 0, 0, 0], "", false],
]) check(`comboLabel ${combo.join("-")}`, () => comboLabel(combo, t), { text, uniform });
for (const [key, value, expected] of [
  ["recent_win30", 0.335, "34%"], ["recent_win30", 0, "0%"],
  ["motor_2", 38.24, "38.2%"], ["boat_2", 40, "40.0%"],
  ["win_rate", 6.789, "6.79"], ["local_win", 5, "5.00"],
]) check(`fmtFactValue ${key} ${value}`, () => fmtFactValue(key, value), expected);
for (const key of ["recent_win30", "motor_2", "boat_2", "win_rate", "local_win"]) {
  for (const [name, value] of [["null", null], ["undefined", undefined], ["NaN", NaN]])
    check(`fmtFactValue ${key} ${name}`, () => fmtFactValue(key, value), "—");
}
for (const [name, rank, bad, expected] of [
  ["6艇単独", { of: 6, from: 2, to: 2 }, "low", "6艇中2位"],
  ["6艇最下位は補足なし", { of: 6, from: 6, to: 6 }, "low", "6艇中6位"],
  ["6艇同率", { of: 6, from: 2, to: 3, same: 2 }, "low", "6艇中2〜3位（同じ値が2艇）"],
  ["5艇最下位", { of: 5, from: 5, to: 5 }, "low", "記録のある5艇中5位（一番低い）"],
  ["5艇同率最下位", { of: 5, from: 4, to: 5, same: 2 }, "slow", "記録のある5艇中4〜5位（同じ値が2艇）（一番遅い）"],
  ["5艇途中は補足なし", { of: 5, from: 3, to: 3 }, "low", "記録のある5艇中3位"],
  ["1艇だけは補足なし", { of: 1, from: 1, to: 1 }, "low", "記録のある1艇中1位"],
]) check(`factRankText ${name}`, () => factRankText(t, rank, bad), expected);

// 仕様未定の入力は assert せず、実行時の値（例外も含む）を観測する。
function observe(run) {
  try { return run(); }
  catch (error) { return { name: error.name, message: error.message }; }
}
const KNOWN_GAPS = [
  {
    input: "fmtCount(NaN)", specification: "未定（NaNの扱いはコメントに無し）",
    actual: observe(() => fmtCount(NaN)),
  },
  {
    input: 'factRankText(t, {of:7, from:7, to:7}, "low")',
    specification: "未定（6艇超の入力は仕様に無し）",
    actual: observe(() => factRankText(t, { of: 7, from: 7, to: 7 }, "low")),
  },
];
console.log(`KNOWN_GAPS ${KNOWN_GAPS.length}件: ${JSON.stringify(KNOWN_GAPS)}`);
console.log(`${total}件: PASS ${total - failures} / FAIL ${failures}`);
if (failures > 0) process.exitCode = 1;
