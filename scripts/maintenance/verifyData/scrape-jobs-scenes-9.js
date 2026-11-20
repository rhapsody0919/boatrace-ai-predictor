/**
 * verify-scrape-jobs.js の後半の場面（9/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let printOut, show, KNOWN_GAPS;

function scene1() {
  printOut(`\nKNOWN_GAPS: ${KNOWN_GAPS.length} 件`);
  for (const gap of KNOWN_GAPS) printOut(show(gap));
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・show・KNOWN_GAPS） */
export function runScrapeJobsScenes9(env) {
  ({ printOut, show, KNOWN_GAPS } = env);
  scene1();
}
