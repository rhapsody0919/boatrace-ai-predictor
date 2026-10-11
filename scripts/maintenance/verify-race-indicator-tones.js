#!/usr/bin/env node
/**
 * レース詳細の良し悪しの色（緑・赤）を付けるかの判定の回帰テスト。
 * docs/design/race-detail-ui-unify plan §6。DB 接続は不要。
 *
 * 1. 今節タブの「今節のST」判定文 `meetStVerdictTone`（src/components/race/basicInfoStats.js）
 *    （PR #1187 ファン評価1周目）:
 *   - 差 0.01 では色を付けない（計測の誤差の範囲。赤の「慎重」が準優の1号艇に出ていた）
 *   - 今節2走以下では色を付けない（初日の1走だけで赤が出ていた）
 *   - 差 0.02 以上・3走以上なら、早い＝good、遅い＝bad
 *   - 浮動小数の誤差（0.13 − 0.11 = 0.020000000000000018 等）は表示の2桁で丸めて判定する
 *
 * 2. 枠別情報タブ ST考察の平均との差 `diffTone`（src/utils/courseBaseline.js）
 *    （PR #1187 ファン評価2周目）:
 *   - 走数が少ない艇（small）は色なし（1走で「−56.1」が赤く出ていた）
 *   - 表示の1桁で ±0.1 以内の差は色なし（「0.0」は記号が無い、「−0.1」は実質平均どおり。BOA-711）
 *   - 向きが決まらない（isBetter が null）なら色なし
 */
import { meetStVerdictTone } from "../../src/components/race/basicInfoStats.js";
import { diffTone } from "../../src/utils/courseBaseline.js";

const CASES = [
  ["差 −0.02・3走は good", -0.02, 3, "good"],
  ["差 +0.02・3走は bad", 0.02, 3, "bad"],
  ["差 +0.01・8走は色なし", 0.01, 8, null],
  ["差 −0.01・8走は色なし", -0.01, 8, null],
  ["差 +0.03・1走は色なし", 0.03, 1, null],
  ["差 −0.05・2走は色なし", -0.05, 2, null],
  ["浮動小数の誤差（0.11 − 0.13）は −0.02 として good", 0.11 - 0.13, 6, "good"],
  ["浮動小数の誤差（0.0199999）は 0.02 として bad", 0.0199999, 6, "bad"],
  ["差 null は色なし", null, 6, null],
];

const TONE_CASES = [
  ["平均より良い・走数十分は better", { isBetter: true, diff: 4.2 }, "better"],
  ["平均より悪い・走数十分は worse", { isBetter: false, diff: -8.4 }, "worse"],
  ["走数が少ないと色なし", { isBetter: false, diff: -56.1, small: true }, null],
  ["0.0 と出る差は色なし", { isBetter: true, diff: 0.04 }, null],
  // BOA-711: 表示で ±0.1 の差は「平均どおり」。−0.1 が赤くなっていた
  ["−0.1 は色なし", { isBetter: false, diff: -0.1 }, null],
  [
    "+0.1（丸めの誤差 0.09999）も色なし",
    { isBetter: true, diff: 0.09999 },
    null,
  ],
  ["±0.2 からは色", { isBetter: false, diff: -0.2 }, "worse"],
  // 率（%）の行は ±1.0 以内を色なし（安定率 48.3 と平均48.5 の −0.2 が赤くなっていた。BOA-711）
  [
    "率の行: −0.2 は色なし",
    { isBetter: false, diff: -0.2, threshold: 1 },
    null,
  ],
  ["率の行: ±1.0 は色なし", { isBetter: true, diff: 1.0, threshold: 1 }, null],
  [
    "率の行: ±1.1 からは色",
    { isBetter: true, diff: 1.1, threshold: 1 },
    "better",
  ],
  ["isBetter が null は色なし", { isBetter: null, diff: 0 }, null],
  ["diff が null は色なし", { isBetter: true, diff: null }, null],
];

const failures = [
  ...CASES.filter(
    ([, diff, n, expected]) => meetStVerdictTone(diff, n) !== expected,
  ).map(
    ([name, diff, n, expected]) =>
      `meetStVerdictTone ${name}: 期待 ${expected} / 実際 ${meetStVerdictTone(diff, n)}`,
  ),
  ...TONE_CASES.filter(([, arg, expected]) => diffTone(arg) !== expected).map(
    ([name, arg, expected]) =>
      `diffTone ${name}: 期待 ${expected} / 実際 ${diffTone(arg)}`,
  ),
];

if (failures.length > 0) {
  console.error("verify-race-indicator-tones: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  `verify-race-indicator-tones: OK（${CASES.length + TONE_CASES.length}件）`,
);
