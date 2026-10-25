/** BOA-1115: 類似レースの表示用純粋関数の現行値を固定する。 */
import { deepStrictEqual, strictEqual } from "node:assert";
import { inspect } from "node:util";
import {
  gapOf,
  b1Rank,
  topBoat,
  todayDisplay,
} from "../../src/utils/analogySimilarDisplay.js";

let passed = 0;
function check(name, actual, expected) {
  deepStrictEqual(actual, expected, name);
  passed++;
  console.log(`OK: ${name}`);
}

const gapCases = [
  [[6.5, 6, 5.5, 5, 4.5, 4], { gap: 0.5, band: 4 }],
  [[6.19, 6], { gap: 0.19, band: 4 }],
  [[6.18, 6], { gap: 0.18, band: 3 }],
  [[5, 5.49, 0, 0, 0, 0], { gap: -0.49, band: 3 }],
  [[5, 5.5, 0, 0, 0, 0], { gap: -0.5, band: 2 }],
  [[4, 5.14, 0, 0, 0, 0], { gap: -1.14, band: 2 }],
  [[5, 6, 5, 5, 5, 5], { gap: -1, band: 2 }],
  [[3, 4.91, 0, 0, 0, 0], { gap: -1.91, band: 1 }],
  [[3, 4.92, 0, 0, 0, 0], { gap: -1.92, band: 0 }],
  [[6.123, 6], { gap: 0.12, band: 3 }],
  [[6, null, "7", 5, 4, 3], { gap: 1, band: 4 }],
  [[6, null, null, null, null, null], null],
  [[null, 6, 5, 4, 3, 2], null],
  [[], null],
  [null, null],
];
for (const [input, expected] of gapCases) {
  check(`gapOf ${inspect(input)}`, gapOf(input), expected);
}

const rankCases = [
  [[[6, 7, 5, 6, 8, 4], true], 3],
  [[[6, 7, 5, 6, 8, 4], false], 3],
  [[[6, 7, 5]], 2],
  [[[6, 6, 6, 6, 6, 6], true], 1],
  [[[0.15, 0.12, 0.18, 0.15, 0.10, 0.20], false], 3],
  [[[6, null, 7], true], 2],
  [[[6], true], 1],
  [[[null, 7, 5], true], null],
  [[null, true], null],
];
for (const [args, expected] of rankCases) {
  check(`b1Rank ${inspect(args)}`, b1Rank(...args), expected);
}

const topCases = [
  [[5, 7, 7, 6, 4, 3], 2],
  [[null, 5, 6, 6, 2, 1], 3],
  [[7, 7, 7, 7, 7, 7], 1],
  [[null, null, 4], 3],
  [[-1, -2], 1],
  [[null, null, null, null, null, null], null],
  [[], null],
  [null, null],
];
for (const [input, expected] of topCases) {
  check(`topBoat ${inspect(input)}`, topBoat(input), expected);
}

check("todayDisplay null 出走表", todayDisplay(null, {}), null);
check("todayDisplay undefined 出走表", todayDisplay(undefined, {}), null);
const unchanged = { a: 1, weather: 9, exh_diff: [0] };
strictEqual(todayDisplay(unchanged, null), unchanged, "todayDisplay 展示前は同じ参照");
passed++;

const todayCases = [
  [
    "展示の値と小数2桁で上書き",
    { a: 1, weather: 9, ws: 1, wave: 2, exh_diff: [0] },
    { weather_code: 2, wind_speed: 5, wave_height: 3,
      exh_time_diff: [0.123, -0.006, null, 0.016, 1, -0.126] },
    { a: 1, weather: 2, ws: 5, wave: 3,
      exh_diff: [0.12, -0.01, null, 0.02, 1, -0.13] },
  ],
  [
    "天候0を保持し欠損をnullで上書き",
    { a: 1, weather: 9 }, { weather_code: 0 },
    { a: 1, weather: 0, ws: null, wave: null, exh_diff: null },
  ],
  [
    "展示タイム差が配列でない",
    { a: 1 }, { exh_time_diff: "x" },
    { a: 1, weather: null, ws: null, wave: null, exh_diff: null },
  ],
];
for (const [name, racecard, exhibition, expected] of todayCases) {
  const before = structuredClone(racecard);
  check(`todayDisplay ${name}`, todayDisplay(racecard, exhibition), expected);
  check(`todayDisplay 入力を変更しない ${name}`, racecard, before);
}

// 未確定の仕様は assert しない。inspect で負のゼロも失わずに出す。
const KNOWN_GAPS = [
  {
    input: [{ a: 1 }, { exh_time_diff: [-0.004] }],
    specification: "負のゼロの扱いは未定。表示は toFixed で 0.00",
    current: todayDisplay({ a: 1 }, { exh_time_diff: [-0.004] }),
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件\n${inspect(KNOWN_GAPS, { depth: null })}`);
console.log(`✅ 類似レース表示: ${passed}件成功`);
