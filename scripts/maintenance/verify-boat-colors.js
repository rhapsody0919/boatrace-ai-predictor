/** BOA-1038: colors.js の公開値を固定する。外部接続・時計は使わない。 */
import assert from "node:assert/strict";
import {
  getRecoveryColorClass,
  getBoatChipBackground,
  BOAT_COLORS,
  BOAT_LINE_COLORS,
} from "../../src/utils/colors.js";

// 仕様の値: BOA-1038 の期待値と colors.js の JSDoc・境界コメント。
const SPEC = {
  recovery: [
    [1.0, "mct-recovery-good"],
    [1.5, "mct-recovery-good"],
    [0.999, "mct-recovery-ok"],
    [0.9, "mct-recovery-ok"],
    [0.899, "mct-recovery-bad"],
    [null, "mct-recovery-bad"],
    [NaN, "mct-recovery-bad"],
  ],
  chip: [
    [1, "#ffffff"],
    [2, "#000000"],
    [5, "#fdd835"],
    [3, "var(--boat-3-strong, #e53935)"],
    ["4", "var(--boat-4-strong, #1e88e5)"],
    [6, "var(--boat-6-strong, #43a047)"],
    [7, "#ffffff"],
    ["x", "#ffffff"],
  ],
  boats: [
    [1, { bg: "#ffffff", text: "#000000", name: "白" }],
    [2, { bg: "#000000", text: "#ffffff", name: "黒" }],
    [3, { bg: "#e53935", text: "#ffffff", name: "赤" }],
    [4, { bg: "#1e88e5", text: "#ffffff", name: "青" }],
    [5, { bg: "#fdd835", text: "#000000", name: "黄" }],
    [6, { bg: "#43a047", text: "#ffffff", name: "緑" }],
  ],
  lines: [[1, "var(--text-secondary)"], [2, "var(--text-primary)"]],
};

// 今の実装の値: 指定 SHA 65bf85925 を Node 22 で照合した固定値。
// 実行時の戻り値をここへ代入しない（回帰を既知の差として見逃さないため）。
const CURRENT = {
  recovery: [
    "mct-recovery-good", "mct-recovery-good", "mct-recovery-ok",
    "mct-recovery-ok", "mct-recovery-bad", "mct-recovery-bad", "mct-recovery-bad",
  ],
  chip: [
    "#ffffff", "#000000", "#fdd835",
    "var(--boat-3-strong, #e53935)", "var(--boat-4-strong, #1e88e5)",
    "var(--boat-6-strong, #43a047)", "#ffffff", "#ffffff",
  ],
  boats: [
    { bg: "#ffffff", text: "#000000", name: "白" },
    { bg: "#000000", text: "#ffffff", name: "黒" },
    { bg: "#e53935", text: "#ffffff", name: "赤" },
    { bg: "#1e88e5", text: "#ffffff", name: "青" },
    { bg: "#fdd835", text: "#000000", name: "黄" },
    { bg: "#43a047", text: "#ffffff", name: "緑" },
  ],
  lines: ["var(--text-secondary)", "var(--text-primary)"],
};

const KNOWN_GAPS = [];
const readers = {
  recovery: getRecoveryColorClass,
  chip: getBoatChipBackground,
  boats: (number) => BOAT_COLORS[number],
  lines: (number) => BOAT_LINE_COLORS[number],
};
let passed = 0;
for (const [group, cases] of Object.entries(SPEC)) {
  for (const [index, [input, expected]] of cases.entries()) {
    const current = CURRENT[group][index];
    if (!isEqual(expected, current)) {
      KNOWN_GAPS.push({ group, input, specification: expected, current });
      continue;
    }
    const name = `${group}(${String(input)})`;
    assert.deepStrictEqual(readers[group](input), expected, name);
    console.log(`PASS: ${name}`);
    passed += 1;
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}`, KNOWN_GAPS);
console.log(`OK: 艇番と回収率の色 ${passed}件`);

function isEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
