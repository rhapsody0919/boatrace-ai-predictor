/** BOA-1112: ST・F/L・レースタイムの既存の読み方を固定する。通信・DB接続なし。 */
import { deepStrictEqual } from "node:assert/strict";
import { parseStartCell, parseRaceSeconds } from "../lib/raceResultParser.js";
import { parseStartExhibitionCell } from "../lib/beforeInfoParser.js";

let passed = 0;
function check(name, actual, expected) {
  deepStrictEqual(actual, expected, name);
  passed++;
}

const startCases = [
  [".07 逃げ", 0.07, false, false],
  [".07", 0.07, false, false],
  ["  .15  まくり", 0.15, false, false],
  ["．１３", 0.13, false, false],
  [".1", 0.1, false, false],
  ["F.04", 0.04, true, false],
  ["F.04 恵まれ", 0.04, true, false],
  ["F", null, true, false],
  ["L", null, false, true],
  ["L.05", 0.05, false, true],
  ["", null, false, false],
  [null, null, false, false],
  [undefined, null, false, false],
  ["K", null, false, false],
];
for (const [input, startTiming, isFlying, isLateStart] of startCases) {
  check(`parseStartCell: ${String(input)}`, parseStartCell(input), {
    startTiming, isFlying, isLateStart,
  });
}

const raceCases = [
  [`1'49"5`, 109.5],
  [`1'50"0`, 110],
  [`2'01"3`, 121.3],
  [` 1'49"5 `, 109.5],
  [`１'４９"５`, 109.5],
  [`1'49"55`, null],
  [`49"5`, null],
  [`1'5"5`, null],
  ["", null],
  [null, null],
];
for (const [input, expected] of raceCases) {
  check(`parseRaceSeconds: ${String(input)}`, parseRaceSeconds(input), expected);
}

const exhibitionCases = [
  [".13", 0.13, null],
  [" .08 ", 0.08, null],
  [".1", 0.1, null],
  ["F.01", 0.01, "F"],
  ["Ｆ．０５", 0.05, "F"],
  ["F", null, "F"],
  ["L.05", 0.05, "L"],
  ["L", null, "L"],
  ["", null, null],
  [null, null, null],
];
for (const [input, value, flag] of exhibitionCases) {
  check(`parseStartExhibitionCell: ${String(input)}`, parseStartExhibitionCell(input), {
    value, flag,
  });
}

for (const input of [".13", "F.01", "L.05", "L", "F"]) {
  const start = parseStartCell(input);
  const exhibition = parseStartExhibitionCell(input);
  check(`ST整合: ${input}`, start, {
    startTiming: exhibition.value,
    isFlying: exhibition.flag === "F",
    isLateStart: exhibition.flag === "L",
  });
}

// 公式の表記として現れるか未確認。仕様を決めず、assert から分離する。
const KNOWN_GAPS = [
  {
    input: "0.13", specification: "未定（先頭0で2関数の値が食い違う）",
    currentAtBase: [{ startTiming: null, isFlying: false, isLateStart: false }, { value: 0.13, flag: null }],
    read: (input) => [parseStartCell(input), parseStartExhibitionCell(input)],
  },
  {
    input: "1.5", specification: "未定（先頭の数字を無視して小数部だけ読む）",
    currentAtBase: { value: 0.5, flag: null }, read: parseStartExhibitionCell,
  },
  {
    input: "L1", specification: "未定（Lとして読まない）",
    currentAtBase: { startTiming: null, isFlying: false, isLateStart: false }, read: parseStartCell,
  },
  {
    input: "1’49”5", specification: "未定（曲がった引用符はNFKCで変わらない）",
    currentAtBase: null, read: parseRaceSeconds,
  },
];
console.log(`PASS: ${passed}試験`);
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（非assert）`);
for (const { read, ...gap } of KNOWN_GAPS) {
  console.log(JSON.stringify({ ...gap, current: read(gap.input) }));
}
