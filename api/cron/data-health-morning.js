/**
 * 朝の生成の監視 data_health_morning の Vercel Cron（汎用の日次監視 data_health の朝の分）。
 *
 * 当日の龍神ソナー（analogy_v16_snapshots の出走表の段）が1件以上あるかを、締め 07:50 の後に見る。
 * ポアロ・モリアーティの当日の件数も last_report に載せる（info。scripts/lib/dataHealth/checks.js の MORNING_FRESHNESS_CHECKS）。
 * data_health は対象日を 06:30 で決め、live では 06:35 の成功で対象日を済みにするため、07:50 の締めは別のジョブで見る。
 *
 * DB読み取りのみ（関数 data_health_morning_freshness、マイグレーション170）。書き込みは scrape_job_state
 * （job='data_health_morning'）の last_report だけ。通知は last_report.alerts → scrape-monitor（data_health と同じ経路）。
 * モードは scrape_job_state.mode（off・shadow・live。マイグレーション170が、作るときに data_health と同じ値にする）。
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `55 22,23 * * *`  07:55・08:55 JST（08:55 は補足。処理済みなら、共通ラッパが last_target_date で何もしない）
 *
 * maxDuration は、レジストリ（data_health_morning.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runDataHealthMorningJob } from "../../scripts/lib/dataHealth/job.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "data_health_morning",
  run: (ctx) => runDataHealthMorningJob(ctx),
});
