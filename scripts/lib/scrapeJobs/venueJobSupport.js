/**
 * 会場ごとに取得する日次ジョブ（B3 会場別モーター成績・B4 進入コース別選手成績。tasks.md T4b-14・T4b-13）の
 * 共通部分。純粋関数のみ（DB・取得先に依存しない）。
 *
 * 従来は、会場ごとの成否履歴（構造変化の検知用）を data/analysis/*-health.json に書いて git push していた
 * （BOA-360 の競合の原因）。共通ラッパでは scrape_job_state.last_report に持つ:
 *   last_report = {
 *     date, mode, ...,
 *     health:  { "<会場コード>": {consecutiveFailDays, lastReason, lastCheckedDate} },   // 次の起動が読む
 *     settledVenues: [会場コード...],   // その日、書き込み済みの会場（live のみ。補足の起動が再取得しない）
 *     alerts:  [{key, text}],           // 構造変化の疑い（monitor が Slack に通知する）
 *   }
 * 履歴の更新（updateVenueHealth）は、従来どおり scripts/lib/venueMotorStats/driftHealth.js のコアを使う。
 */
import { updateVenueHealth } from "../venueMotorStats/driftHealth.js";

/**
 * 1会場・1日分の結果を、履歴に反映する。同じ日の再実行（補足の起動）は、その日の結果を置き換え、
 * 連続失敗日数を増やさない（従来は1日1回の実行だったため、素の updateVenueHealth は、呼ぶたびに日数を進める）。
 *
 * @param {{consecutiveFailDays: number, lastReason: string|null, lastCheckedDate: string|null}|undefined} entry
 * @param {{success: boolean, reason: string|null, date: string}} outcome
 */
export function updateHealthForDate(entry, outcome) {
  if (entry && entry.lastCheckedDate === outcome.date) {
    // その日は既に1日として数えている。失敗として数えていたなら、その1日を除いた状態から評価し直す
    const previousFailed =
      entry.lastReason !== null && entry.lastReason !== undefined;
    const base = {
      consecutiveFailDays: previousFailed
        ? Math.max(0, entry.consecutiveFailDays - 1)
        : entry.consecutiveFailDays,
      lastReason: null,
      lastCheckedDate: null,
    };
    return updateVenueHealth(base, outcome);
  }
  return updateVenueHealth(entry, outcome);
}

/**
 * 一時的な失敗か（同じ日の補足の起動で、再取得する価値がある）。
 * 会場サイトの構造変化・データ非公開（http_404・table_not_found・no_data_rows 等）は、待っても直らないため含めない。
 */
const TRANSIENT_REASON_RE =
  /^(http_(408|429|5\d\d)|timeout|network_error|breaker_open)$/;
export function isTransientReason(reason) {
  return typeof reason === "string" && TRANSIENT_REASON_RE.test(reason);
}

/**
 * 取得の例外を、履歴・判定に使う短い理由コードにする（会場サイトの取得は、politeFetch を通すため、
 * 例外の種類が FetchError・BreakerOpenError・AbortError になる）。
 *   http_XXX は、呼び出し側が throw new Error(`http_${status}`) で作る（従来と同じ）
 */
export function reasonFromError(error) {
  const message = error?.message ?? String(error);
  if (error?.name === "AbortError" || message === "timeout") return "timeout";
  if (error?.name === "BreakerOpenError") return "breaker_open";
  if (error?.name === "FetchError") {
    return error.cause?.name === "AbortError" ? "timeout" : "network_error";
  }
  return message;
}

/**
 * 前回の実行が、この日・このモードで、書き込み済みとして記録した会場。live 同士のときだけ引き継ぐ
 * （shadow は書き込まないため、shadow で処理済みの会場を、live が飛ばしてはいけない）。
 *
 * @param {{date?: string, mode?: string, settledVenues?: number[]}|null|undefined} previousReport
 * @param {string} date
 * @param {string} mode
 * @returns {Set<number>}
 */
export function previouslySettledVenues(previousReport, date, mode) {
  if (
    mode === "live" &&
    previousReport?.mode === "live" &&
    previousReport?.date === date &&
    Array.isArray(previousReport.settledVenues)
  ) {
    return new Set(previousReport.settledVenues);
  }
  return new Set();
}

/**
 * 履歴から、構造変化の疑い（閾値日数以上、構造起因の理由で失敗し続けている会場）を、monitor の通知の形にする。
 *
 * @param {Array<{venueCode: string, consecutiveFailDays: number, lastReason: string}>} driftAlerts findDriftAlerts の結果
 * @param {Record<string, string>} nameByCode 会場コード → 会場名
 * @returns {Array<{key: string, text: string}>}
 */
export function driftAlertsToReport(driftAlerts, nameByCode) {
  return driftAlerts.map((a) => ({
    key: `drift:${a.venueCode}`,
    text: `会場公式サイトの構造変化の疑い ${nameByCode[a.venueCode] ?? `会場コード${a.venueCode}`}: ${a.lastReason} が${a.consecutiveFailDays}日連続`,
  }));
}
