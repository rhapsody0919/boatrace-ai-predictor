/**
 * verify-bot-race-function.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { sectionLog } from "./bot-race-function-scenes-3.js";

function scene1() {
  console.log = sectionLog;
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runBotRaceFunctionScenes13() {
  scene1();
}
