/**
 * verify-scrape-result-job.js の後半の場面（7/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { KNOWN_GAPS } from "./scrape-result-job-scenes-b-1.js";

let printOut, show;

function srjb7Scene1() {
  for (const gap of KNOWN_GAPS) {
    let current;
    try {
      current = gap.current();
    } catch (error) {
      current = { error: error.message };
    }
    printOut(show({ input: gap.input, specification: gap.specification, current }));
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・show） */
export function runScrapeResultJobScenesB11(env) {
  ({ printOut, show } = env);
  srjb7Scene1();
}
