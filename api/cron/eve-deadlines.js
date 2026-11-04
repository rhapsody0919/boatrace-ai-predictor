/**
 * 前夜の締切予定の取得（eve_race_deadlines、マイグレーション202、BOA-1282）。
 *
 * scripts/lib/eveDeadlinesJob.js の runEveDeadlinesJob を、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で呼ぶ。
 * 起動元: Vercel Cron（vercel.json の crons）。cron式はUTC:
 *   UTC 11:40 ＝ JST 20:40（指定時刻。その晩の最初の起動は24場とも取る）
 *   UTC 12:00・12:10・12:20 ＝ JST 21:00・21:10・21:20（2〜4回目。21:20 の起動が済みにする）
 * 対象は指定時刻から解決した日の翌日。ジョブ単位のリースで同時に1つだけ走り、書き込みは race_id の upsert（値の変わる行だけ）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（ラッパ）。mode: scrape_job_state（job='eve_deadlines'）。off は何もしない、
 *   shadow は取得・解析のみ、live で書く（マイグレーション202 が live の行を入れる）。
 * maxDuration は registry.js の eve_deadlines.maxDurationSec と同じ値をリテラルで書く（Vercel がビルド時に静的に読むため）。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runEveDeadlinesJob } from "../../scripts/lib/eveDeadlinesJob.js";

export const config = {
  maxDuration: 800,
};

export default createScrapeCronHandler({
  job: "eve_deadlines",
  run: (ctx) => runEveDeadlinesJob(ctx),
});
