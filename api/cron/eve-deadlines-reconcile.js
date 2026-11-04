/**
 * 前夜の締切予定（eve_race_deadlines、マイグレーション202、BOA-1282）と当日の races.start_time の照合。外部への取得は無い。
 *
 * scripts/lib/eveDeadlinesJob.js の runEveDeadlinesReconcileJob を、共通ラッパ経由で呼ぶ。cron式はUTC:
 *   UTC 21:30 ＝ JST 06:30（指定時刻）、UTC 23:00 ＝ JST 08:00（races_init がまだ済んでいなかった日の補足）
 * maxDuration は registry.js の eve_deadlines_reconcile.maxDurationSec と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runEveDeadlinesReconcileJob } from "../../scripts/lib/eveDeadlinesJob.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "eve_deadlines_reconcile",
  run: runEveDeadlinesReconcileJob,
});
