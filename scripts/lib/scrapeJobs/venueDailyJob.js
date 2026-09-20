/**
 * 会場公式サイトから、会場ごとに取得する日次ジョブの共通の流れ（B3 会場別モーター成績・B4 進入コース別選手成績。
 * tasks.md T4b-14・T4b-13）。共通ラッパの run(ctx) から呼ぶ。
 *
 *   1. 前回の last_report から、会場ごとの成否履歴（health）と、その日 live で書き込み済みの会場を読む
 *   2. 書き込み済みでない会場を、同時 concurrency で取得・解析する（ソフトデッドラインを過ぎたら着手しない）
 *   3. 会場ごとに履歴を更新する（同じ日の再実行は1日として数える）。構造変化の疑いは last_report.alerts へ
 *   4. live なら、集めた行を書く（書き込みエラーは例外＝実行の失敗）。shadow は書かない
 *   5. 一時的な失敗（timeout・http_5xx 等）のある会場、または着手しなかった会場があれば incomplete
 *      （対象日を処理済みにせず、補足の起動が、書き込み済みでない会場だけをもう一度取得する）
 *
 * git push・fs（health.json）への依存は無い。履歴は scrape_job_state.last_report に持つ（BOA-360 の競合の恒久解消）。
 */
import { mapWithConcurrency } from "./concurrency.js";
import {
  driftAlertsToReport,
  isTransientReason,
  previouslySettledVenues,
  updateHealthForDate,
} from "./venueJobSupport.js";

/**
 * @param {Object} ctx 共通ラッパの実行の文脈（targetDate は解決済み）
 * @param {Object} params
 * @param {Array<{venueCode: number, name: string}>} params.venues 今回取得する会場（開催のある会場など）
 * @param {(venue: Object) => Promise<{rows: Array<Object>, reason: string|null, stoppedEarly?: boolean}>} params.scrapeVenue
 *   1会場の取得・解析（DBへは書かない）。reason は、失敗した理由（全て成功なら null）
 * @param {(rows: Array<Object>) => Promise<number>} params.writeRows 書き込み（失敗は例外）。書いた行数を返す
 * @param {(health: Object) => Array<Object>} params.findDriftAlerts 履歴から構造変化の疑いを抽出する
 * @param {Record<string, string>} params.nameByCode 会場コード → 会場名（通知用）
 * @param {number} params.concurrency 会場の同時取得数
 * @param {Object} [params.reportExtra] last_report・body に足す項目
 */
export async function runVenueDailyJob(
  ctx,
  {
    venues,
    scrapeVenue,
    writeRows,
    findDriftAlerts,
    nameByCode,
    concurrency,
    reportExtra = {},
  },
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const live = ctx.mode === "live";
  const previousReport = ctx.state?.last_report ?? null;
  const health = structuredClone(previousReport?.health ?? {});
  const alreadySettled = previouslySettledVenues(
    previousReport,
    date,
    ctx.mode,
  );

  const targets = venues.filter((v) => !alreadySettled.has(v.venueCode));
  const results = await mapWithConcurrency(
    targets,
    concurrency,
    async (venue) => {
      if (ctx.shouldStop()) return { venue, notAttempted: true, rows: [] };
      const r = await scrapeVenue(venue);
      // ソフトデッドラインで会場の途中までしか取得できなかった: 成否を判定せず、次の起動でやり直す
      if (r.stoppedEarly) return { venue, notAttempted: true, rows: r.rows };
      return { venue, ...r };
    },
  );

  const attempted = results.filter((r) => !r.notAttempted);
  const notAttempted = results.filter((r) => r.notAttempted);
  const allRows = results.flatMap((r) => r.rows);

  for (const r of attempted) {
    const key = String(r.venue.venueCode);
    health[key] = updateHealthForDate(health[key], {
      success: r.reason === null,
      reason: r.reason,
      date,
    });
  }

  // 書き込み（live のみ）。エラーは例外にする＝実行の失敗（対象日は処理済みにならない）
  const rowsWritten = live && allRows.length > 0 ? await writeRows(allRows) : 0;

  // その日、書き込み済みとして次の起動が飛ばす会場: live で、全ページの取得・解析に成功した会場
  const settled = new Set(alreadySettled);
  if (live) {
    for (const r of attempted) {
      if (r.reason === null && r.rows.length > 0)
        settled.add(r.venue.venueCode);
    }
  }

  const transient = attempted.filter((r) => isTransientReason(r.reason));
  const alerts = driftAlertsToReport(findDriftAlerts(health), nameByCode);

  const venueReports = attempted.map((r) => ({
    venueCode: r.venue.venueCode,
    rows: r.rows.length,
    reason: r.reason,
  }));
  const report = {
    date,
    mode: ctx.mode,
    health,
    settledVenues: [...settled].sort((a, b) => a - b),
    alerts,
    venues: venueReports,
    venuesNotAttempted: notAttempted.map((r) => r.venue.venueCode),
    ...reportExtra,
  };

  return {
    rowsWritten,
    // 0件エラー: 今回取得した会場がある（期待あり）のに、全会場で解析できた行が0件なら、共通ラッパが失敗にする
    rowsExpected: attempted.length,
    rowsParsed: allRows.length,
    incomplete: transient.length > 0 || notAttempted.length > 0,
    report,
    body: {
      venuesAttempted: attempted.length,
      venuesSkippedAsSettled: alreadySettled.size,
      venuesNotAttempted: report.venuesNotAttempted,
      transientFailures: transient.map((r) => r.venue.venueCode),
      rowsParsed: allRows.length,
      alerts: alerts.length,
      ...reportExtra,
    },
  };
}
