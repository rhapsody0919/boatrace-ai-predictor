/**
 * verify-bot-page-model.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let report;

function scene1() {
  report();
}

/** verify から呼ぶ入口。env は verify 側の束縛（report） */
export function runBotPageModelScenes15(env) {
  ({ report } = env);
  scene1();
}
