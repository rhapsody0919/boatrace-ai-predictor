/**
 * 会場別モーター成績（B3、venue_motor_stats）の共通ラッパ向けハンドラー（tasks.md T4b-14-1）。
 * api/cron/venue-motor-stats.js が createScrapeCronHandler の run に渡す。
 *
 * 従来（GitHub Actions）との違い:
 *   - 対象日（scraped_date）: 共通ラッパが「06:00 JST の指定時刻」から解決した ctx.targetDate（実行が遅れても、
 *     08:00 JST の補足の起動が、同じ対象日を処理する）
 *   - 会場ごとの成否履歴（構造変化の検知）: data/analysis/venue-motor-stats-health.json の git push をやめ、
 *     scrape_job_state.last_report に持つ（BOA-360 の git push の競合の恒久解消）。構造変化の疑い（14日連続）は
 *     last_report.alerts → scrape-monitor がSlackへ通知する
 *   - 取得先への負荷（ADR-0067）: 従来は、22会場を、待機なしで逐次に取得していた（各会場は別ドメイン）。
 *     Vercel では、会場の同時取得を VENUE_MOTOR_STATS_CONCURRENCY に抑え、politeFetch（15秒タイムアウト・
 *     429/503のバックオフ・会場サイトごとのサーキットブレーカー）を通す。各ドメインへのリクエストは、1日1回・1〜2ページ
 *     （宮島のみ一覧＋PDFの2件）。GitHub Actions の実測（2026-09-19、22会場・宮島のPDF込みで29秒）から、
 *     同時4で約10秒
 *   - 一時的な失敗（timeout・http_5xx）の会場は、対象日を処理済みにせず、補足の起動が、書き込み済みでない会場だけを取得する
 *   - mode: shadow は取得・解析のみ（venue_motor_stats へ書かない）。off は何もしない
 *   - 書き込みエラーは、ログだけで済ませず、実行の失敗にする
 */
import { runVenueDailyJob } from "./scrapeJobs/venueDailyJob.js";
import { reasonFromError } from "./scrapeJobs/venueJobSupport.js";
import { VENUE_MOTOR_STATS_CONFIG } from "./venueMotorStats/venueConfig.js";
import { findDriftAlerts } from "./venueMotorStats/driftHealth.js";
import {
  createParsers,
  scrapeVenueMotorStats,
  toMotorStatsRow,
  writeMotorStatsRows,
} from "../daily/scrape-venue-motor-stats.js";

/** 会場（別ドメイン）の同時取得数 */
export const VENUE_MOTOR_STATS_CONCURRENCY = 4;

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runVenueMotorStatsJob(
  ctx,
  {
    scrapeOne = scrapeVenueMotorStats,
    write = writeMotorStatsRows,
    concurrency = VENUE_MOTOR_STATS_CONCURRENCY,
    venueConfig = VENUE_MOTOR_STATS_CONFIG,
  } = {},
) {
  const date = ctx.targetDate;
  const parsers = createParsers(ctx.politeFetch);

  return runVenueDailyJob(ctx, {
    venues: venueConfig,
    scrapeVenue: async (venue) => {
      const { data, reason } = await scrapeOne(venue, {
        parsers,
        toReason: reasonFromError,
      });
      return {
        rows: (data ?? []).map((m) => toMotorStatsRow(venue, m, date)),
        reason,
      };
    },
    writeRows: (rows) => write(ctx.client, rows, { throwOnError: true }),
    findDriftAlerts,
    nameByCode: Object.fromEntries(
      venueConfig.map((v) => [String(v.venueCode), v.name]),
    ),
    concurrency,
  });
}
