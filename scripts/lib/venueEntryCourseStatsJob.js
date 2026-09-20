/**
 * 進入コース別選手成績（B4、venue_entry_course_stats）の共通ラッパ向けハンドラー（tasks.md T4b-13-1）。
 * api/cron/entry-course-stats.js が createScrapeCronHandler の run に渡す。
 *
 * 従来（GitHub Actions）との違い:
 *   - 対象日: 共通ラッパが「20:00 JST の指定時刻」から解決した ctx.targetDate（G2: 20:00指定の実行が日付をまたいで
 *     起動し、まだ races が無い翌日を対象日にして0件を保存していた問題の恒久対策）。22:30・00:30 JST の補足の起動も、
 *     同じ対象日を処理する。当日の出走表（races・race_entries）がある会場だけを処理する（従来と同じ）
 *   - 会場ごとの成否履歴（構造変化の検知）: data/analysis/venue-entry-course-stats-health.json の git push をやめ、
 *     scrape_job_state.last_report に持つ。構造変化の疑い（14日連続）は last_report.alerts → scrape-monitor がSlackへ通知する
 *   - 取得: politeFetch（会場サイトごとにブレーカー）。会場内は逐次（300ms間隔）、会場間は同時 ENTRY_COURSE_CONCURRENCY
 *   - 一時的な失敗（timeout・http_5xx）の会場は、対象日を処理済みにせず、補足の起動が、その会場だけをもう一度取得する
 *   - mode: shadow は取得・解析のみ（venue_entry_course_stats へ書かない）。off は何もしない
 *   - 書き込みエラーは、ログだけで済ませず、実行の失敗にする
 */
import { getRaceSchedule } from "./raceSchedule.js";
import { runVenueDailyJob } from "./scrapeJobs/venueDailyJob.js";
import { reasonFromError } from "./scrapeJobs/venueJobSupport.js";
import { VENUE_ENTRY_COURSE_STATS_CONFIG } from "./venueEntryCourseStats/venueConfig.js";
import { findEntryCourseStatsDriftAlerts } from "./venueEntryCourseStats/driftHealth.js";
import {
  createHtmlFetcher,
  scrapeVenue,
  writeEntryCourseRows,
} from "../daily/scrape-venue-entry-course-stats.js";

/** 会場（別ドメイン）の同時取得数。1会場内は逐次のため、各ドメインへの同時リクエストは常に1 */
export const ENTRY_COURSE_CONCURRENCY = 3;

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runVenueEntryCourseStatsJob(
  ctx,
  {
    getSchedule = getRaceSchedule,
    scrapeOneVenue = scrapeVenue,
    write = writeEntryCourseRows,
    concurrency = ENTRY_COURSE_CONCURRENCY,
    venueConfig = VENUE_ENTRY_COURSE_STATS_CONFIG,
    delayMs,
  } = {},
) {
  const date = ctx.targetDate;
  // DB障害を「開催なし」にしない（getRaceSchedule は、既定ではDBエラーを空配列にする）
  const schedule = await getSchedule(date, {
    throwOnError: true,
    client: ctx.client,
  });
  if (schedule.length === 0) {
    // 対象日の races が1件も無い＝朝の初期化の失敗、または対象日の誤り。0件を成功にしない
    return {
      outcome: "error",
      error: `対象日${date}の races が0件です（朝の初期化の失敗、または対象日の誤りの疑い）`,
      report: { date, mode: ctx.mode, skipped: "no_schedule" },
    };
  }

  const fetchHtmlImpl = createHtmlFetcher(ctx.politeFetch);
  const venues = venueConfig
    .map((venue) => ({
      ...venue,
      races: schedule.filter((r) => r.venue_code === venue.venueCode),
    }))
    .filter((venue) => venue.races.length > 0);

  return runVenueDailyJob(ctx, {
    venues,
    scrapeVenue: (venue) =>
      scrapeOneVenue(venue, venue.races, {
        client: ctx.client,
        fetchHtmlImpl,
        toReason: reasonFromError,
        shouldStop: ctx.shouldStop,
        ...(delayMs !== undefined ? { delayMs } : {}),
      }),
    writeRows: (rows) => write(ctx.client, rows, { throwOnError: true }),
    findDriftAlerts: findEntryCourseStatsDriftAlerts,
    nameByCode: Object.fromEntries(
      venueConfig.map((v) => [String(v.venueCode), v.name]),
    ),
    concurrency,
    reportExtra: { venuesWithRaces: venues.length },
  });
}
