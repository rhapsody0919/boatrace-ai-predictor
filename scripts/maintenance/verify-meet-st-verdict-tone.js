#!/usr/bin/env node
/**
 * 今節タブの「今節のST」判定文の色 `meetStVerdictTone`（src/components/race/basicInfoStats.js）の
 * 回帰テスト。docs/design/race-detail-ui-unify plan §6。DB 接続は不要。
 *
 * 守ること（PR #1187 ファン評価1周目）:
 *   - 差 0.01 では色を付けない（計測の誤差の範囲。赤の「慎重」が準優の1号艇に出ていた）
 *   - 今節2走以下では色を付けない（初日の1走だけで赤が出ていた）
 *   - 差 0.02 以上・3走以上なら、早い＝good、遅い＝bad
 *   - 浮動小数の誤差（0.13 − 0.11 = 0.020000000000000018 等）は表示の2桁で丸めて判定する
 */
import { meetStVerdictTone } from "../../src/components/race/basicInfoStats.js";

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

const failures = CASES.filter(
  ([, diff, n, expected]) => meetStVerdictTone(diff, n) !== expected,
).map(
  ([name, diff, n, expected]) =>
    `${name}: 期待 ${expected} / 実際 ${meetStVerdictTone(diff, n)}`,
);

if (failures.length > 0) {
  console.error("verify-meet-st-verdict-tone: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-meet-st-verdict-tone: OK（${CASES.length}件）`);
