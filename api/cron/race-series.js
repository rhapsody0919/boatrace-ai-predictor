/**
 * 節（race_series、マイグレーション084）の Vercel Cron。前月・当月・翌月の月間スケジュール（3リクエスト）から、
 * 開始日が当月・翌月の節を書く（値の違う行だけ）。実装: scripts/lib/raceSeriesJob.js
 *
 * cron式（vercel.json）はUTC:
 *   UTC 19:00 ＝ JST 04:00（指定時刻）
 *   UTC 20:30 ＝ JST 05:30（補足。04:00 が失敗・未配信だった場合のみ処理する。処理済みなら last_target_date で何もしない）
 * 夜間にする理由: 開催時間帯の取得（毎分の窓型ジョブ）と取得先への負荷を重ねないため。
 * 毎日にする理由: 翌月の節名は、日程より後から公式に載るため（raceSeriesJob.js の冒頭）。
 *
 * モード（scrape_job_state.mode の job='race_series'）: off（または行なし）は何もしない。shadow は取得・解析のみ。live は書く。
 *
 * maxDuration は、レジストリ（race_series.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRaceSeriesJob } from "../../scripts/lib/raceSeriesJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "race_series",
  run: (ctx) => runRaceSeriesJob(ctx),
});
