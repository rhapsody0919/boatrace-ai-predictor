/**
 * verify-race-entry-rate-precision.js - 朝の初期化が race_entries に書く2連率・3連率の桁（BOA-829）。DBには接続しない。
 *
 * 守るもの: 公式の出走表の2連率・3連率は小数2桁（例 33.05）。朝の初期化（generate-predictions の
 * processRacersWithScoreFn → race_entries）が小数1桁に丸めると、発走60分前の取得で上書きされるまで丸めた値
 * （33.0）が入り、2026-09-12〜22 には上書きされないまま残ったレースが118あった
 */
import { processRacersWithScoreFn } from "../daily/generate-predictions.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 実例: 住之江 2026-10-11 1R の1号艇（公式 33.05 / 52.54 / 32.71 / 44.86 / 46.92 / 66.15 / 38.24 / 50.00）
const racer = {
  lane: 1,
  racerId: 3915,
  name: "テスト",
  grade: "A2",
  age: 52,
  globalWinRate: 6.38,
  localWinRate: 5.31,
  global2Rate: 46.92,
  global3Rate: 66.15,
  local2Rate: 38.24,
  local3Rate: 50,
  motorNumber: 61,
  motor2Rate: 33.05,
  motor3Rate: 52.54,
  boatNumber: 66,
  boat2Rate: 32.71,
  boat3Rate: 44.86,
};
const [p] = processRacersWithScoreFn([racer], () => 0, null, []);
const expected = {
  global2Rate: 46.92,
  global3Rate: 66.15,
  local2Rate: 38.24,
  local3Rate: 50,
  motor2Rate: 33.05,
  motor3Rate: 52.54,
  boat2Rate: 32.71,
  boat3Rate: 44.86,
};
for (const [k, v] of Object.entries(expected)) {
  check(
    `${k} は公式と同じ値（${v}）で、小数1桁に丸めない`,
    parseFloat(p[k]) === v,
    `実際: ${p[k]}`,
  );
}
// 0 の艇（未使用の新モーター等）は null にせず 0 のまま
const [zero] = processRacersWithScoreFn(
  [{ ...racer, motor2Rate: 0, motor3Rate: 0 }],
  () => 0,
  null,
  [],
);
check(
  "モーター2連率 0 は 0 のまま（null にしない）",
  parseFloat(zero.motor2Rate) === 0,
  `実際: ${zero.motor2Rate}`,
);

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全て成功");
