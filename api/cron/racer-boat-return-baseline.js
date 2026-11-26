/**
 * 選手ページの回収率の全国の基準（racer_boat_return_baseline）を毎晩数え直す Vercel Cron。
 * 案・SQL・手順: docs/design/racer-return-baseline/db-draft.md。実装: scripts/lib/racerBoatReturnBaselineJob.js
 * 外部サイトへの通信は無い（DB の中の集計。ADR-0066 改訂1）。
 *
 * モード（scrape_job_state.mode の job='racer_boat_return_baseline'）:
 *   off（または行なし）  何もしない（最初の起動で off の行ができる。live にするのはオーナー）
 *   shadow              数えるだけ（書かない）
 *   live                書く
 *
 * cron式（vercel.json に人が足す）はUTC。JST換算:
 *   `20 16 * * *`  01:20 JST（result-catchup の UTC 14:50・15:30 の後）
 *   `20 20 * * *`  05:20 JST（補足。01:20 が失敗・途中で打ち切りだった場合のみ処理する）
 *
 * maxDuration は、レジストリ（racer_boat_return_baseline.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerBoatReturnBaselineJob } from "../../scripts/lib/racerBoatReturnBaselineJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "racer_boat_return_baseline",
  run: async (ctx) =>
    runRacerBoatReturnBaselineJob({
      client: ctx.client,
      today: ctx.targetDate,
      dryRun: ctx.mode !== "live",
      shouldStop: ctx.shouldStop,
    }),
});
