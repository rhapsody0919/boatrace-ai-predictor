/**
 * 進入コース別選手成績ページ（BOA-293、FR-6 Phase 6c）の、会場公式サイトのHTML構造変化の検知。
 *
 * scripts/lib/venueMotorStats/driftHealth.js の STRUCTURAL_DRIFT_REASONS は venue_motor_stats 固有の
 * reason コードに決め打ちされているため、reason コードの分類のみ本FR用に再定義する
 * （updateVenueHealth のコアと DRIFT_ALERT_THRESHOLD_DAYS は再利用する）。
 *
 * no_active_meet（本日の出走スケジュールがあるのに会場サイトが「次節開催まで
 * お待ちください」を返す状態）は、サイト側の一時的な非公開・開催中止・自社スケジュールとの日ズレでも
 * 起こりうるため、構造変化としては扱わない（STRUCTURAL_DRIFT_REASONS に含めない）。
 *
 * 利用元: scripts/maintenance/check-venue-entry-course-stats-drift.js（GitHub Actions）、
 *         scripts/lib/venueEntryCourseStatsJob.js（Vercel。結果は last_report.alerts へ）
 */
import { DRIFT_ALERT_THRESHOLD_DAYS } from "../venueMotorStats/driftHealth.js";

export const ENTRY_COURSE_STRUCTURAL_DRIFT_REASONS = new Set([
  "entry_course_table_not_found",
  "unexpected_table_header",
  "no_data_rows",
]);

export function isEntryCourseStructuralDriftReason(reason) {
  return reason != null && ENTRY_COURSE_STRUCTURAL_DRIFT_REASONS.has(reason);
}

/**
 * 履歴全体から、構造変化の疑いがある会場（閾値日数以上、構造起因のreasonで失敗し続けている会場）を抽出する。
 * @param {Record<string, {consecutiveFailDays: number, lastReason: string|null}>} health
 * @returns {Array<{venueCode: string, consecutiveFailDays: number, lastReason: string}>}
 */
export function findEntryCourseStatsDriftAlerts(health) {
  return Object.entries(health)
    .filter(
      ([, entry]) =>
        entry.consecutiveFailDays >= DRIFT_ALERT_THRESHOLD_DAYS &&
        isEntryCourseStructuralDriftReason(entry.lastReason),
    )
    .map(([venueCode, entry]) => ({
      venueCode,
      consecutiveFailDays: entry.consecutiveFailDays,
      lastReason: entry.lastReason,
    }));
}
