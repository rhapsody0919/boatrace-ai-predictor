#!/usr/bin/env node
/**
 * モーターの推移の節の印で、優勝戦を1着で走った節を「優勝」にすること（本番の公式の記号は普通の着でも "1"〜"6" が入る）の検査。
 * 純関数（src/pure/motorGenerationTrend.js の motorMeetFinals）だけを見る。本番 DB には繋がない。
 *
 * 守ること:
 *   - 1着で記号が "1"（全角の "１" も）か無ければ優勝。2着以下・F 等の記号の走は優出
 */
import { motorMeetFinals } from "../../src/pure/motorGenerationTrend.js";

const failures = [];
const finalRun = (finish, finishMark) => ({ raceId: "2026-11-01-02-12", date: "2026-11-01", motor2Rate: 30, isFinal: true, finish, finishMark });
const markOf = (finish, finishMark) => motorMeetFinals([finalRun(finish, finishMark)]).get("2026-11-01");

[
  ["1着・記号 1 は優勝", markOf(1, "1"), "win"],
  ["1着・記号 １ は優勝", markOf(1, "１"), "win"],
  ["1着・記号なしは優勝", markOf(1, null), "win"],
  ["3着・記号 3 は優出", markOf(3, "3"), "final"],
  ["1着でも記号 F は優出", markOf(1, "F"), "final"],
  ["着なし・記号 転 は優出", markOf(null, "転"), "final"],
].forEach(([name, got, want]) => {
  if (got !== want) failures.push(`${name}: 期待 ${want}、実際 ${got}`);
});

if (failures.length > 0) {
  console.error(`verify-motor-meet-win-mark: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-motor-meet-win-mark: OK");
