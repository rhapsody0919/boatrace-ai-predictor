/**
 * 会場公式サイトのHTML構造変化を検知するための、日次スクレイピング結果の
 * 履歴管理ロジック（BOA-285）。
 *
 * パーサーが返すreasonのうち、以下はサイト側のHTML構造が変わった可能性を示す
 * （見出し行・テーブル・PDFリンクが見つからない＝実装時に想定した構造が
 * もう存在しない）。一方 no_data_rows やhttp_5xx等は、モーター交換期間中の
 * 一時的なデータ非公開や、サイト側の一時的な障害でも起こりうるため対象外とする
 */
export const STRUCTURAL_DRIFT_REASONS = [
  "motor_stats_table_not_found",
  "table_not_found",
  "motor_number_column_not_found",
  "unexpected_table_header",
  "pdf_link_not_found",
];

// pdf2jsonの解析自体が失敗した場合（miyajimaPdf.js）は`pdf_parse_error: <詳細>`と
// 動的な文字列になるため、完全一致ではなく前方一致で構造起因と判定する
const STRUCTURAL_DRIFT_REASON_PREFIXES = ["pdf_parse_error:"];

function isStructuralDriftReason(reason) {
  if (reason === null || reason === undefined) return false;
  return (
    STRUCTURAL_DRIFT_REASONS.includes(reason) ||
    STRUCTURAL_DRIFT_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix))
  );
}

/**
 * 構造的な失敗が何日続いたらアラートにするかの閾値。
 * 唐津・丸亀の実例（2026-09時点で最大 約1〜2週間の「新モーター切替期間」で
 * 一時的にテーブル自体が消える）より確実に長い期間を置き、正常な運用状態を
 * 誤検知しないようにする。閾値を短くするほど検知は早いが誤報が増える
 * トレードオフがあるため、運用実績を見て調整することを想定している
 */
export const DRIFT_ALERT_THRESHOLD_DAYS = 14;

/**
 * 1会場・1日分のスクレイピング結果を反映し、更新後の履歴エントリを返す（純関数）。
 * @param {{consecutiveFailDays: number, lastReason: string|null, lastCheckedDate: string|null}|undefined} entry
 * @param {{success: boolean, reason: string|null, date: string}} outcome
 */
export function updateVenueHealth(entry, outcome) {
  const prev = entry ?? { consecutiveFailDays: 0, lastReason: null };
  if (outcome.success) {
    return {
      consecutiveFailDays: 0,
      lastReason: null,
      lastCheckedDate: outcome.date,
    };
  }
  return {
    consecutiveFailDays: prev.consecutiveFailDays + 1,
    lastReason: outcome.reason,
    lastCheckedDate: outcome.date,
  };
}

/**
 * 履歴全体から、構造変化の疑いがある会場（閾値日数以上、構造起因のreasonで
 * 失敗し続けている会場）を抽出する。
 * @param {Record<string, {consecutiveFailDays: number, lastReason: string|null}>} health
 * @returns {Array<{venueCode: string, consecutiveFailDays: number, lastReason: string}>}
 */
export function findDriftAlerts(health) {
  return Object.entries(health)
    .filter(
      ([, entry]) =>
        entry.consecutiveFailDays >= DRIFT_ALERT_THRESHOLD_DAYS &&
        isStructuralDriftReason(entry.lastReason),
    )
    .map(([venueCode, entry]) => ({
      venueCode,
      consecutiveFailDays: entry.consecutiveFailDays,
      lastReason: entry.lastReason,
    }));
}
