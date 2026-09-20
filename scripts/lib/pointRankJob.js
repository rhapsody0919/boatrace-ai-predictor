/**
 * 得点率（B2、racer_series_points）の共通ラッパ向けハンドラー（tasks.md T4b-12-1、plan.md §4.3）。
 * api/cron/point-rank.js が createScrapeCronHandler の run に渡す。
 *
 * 従来（GitHub Actions）との違い:
 *   - 対象日: 実行時刻ではなく、共通ラッパが「22:00 JST の指定時刻」から解決した ctx.targetDate を使う
 *     （GitHub Actionsの遅延起動で、対象日が翌日になって「開催会場なし」で0件になった問題。G1・BOA-364・BOA-291）。
 *     23:30・01:30 JST の補足の起動も、同じ対象日を処理する（処理済みなら共通ラッパが何もしない）
 *   - 取得: politeFetch（15秒タイムアウト・429/503のバックオフ・サーキットブレーカー）。会場は同時 POINT_RANK_CONCURRENCY
 *   - 失敗: 会場の取得失敗・「SG/G1の4日目以降なのに表が無い」・書き込みエラーは、実行の失敗（outcome:"error"）。
 *     表のある会場の行は書く（他会場の取得済みデータを捨てない）。失敗した対象日は処理済みにならず、補足の起動が再試行する
 *   - mode: shadow は取得・解析のみ（racer_series_points へ書かない）。off は何もしない
 *   - 0件エラー: 期待会場数（SG/G1の4日目以降）が0でないのに、解析できた行が0件なら失敗（共通ラッパの判定）。
 *     表が無いのが仕様の日（一般戦・G3・SG/G1の序盤）は、期待0件で正常
 */
import { run as runPointRank } from "../daily/scrape-point-rank.js";

/** 会場（1ページ、約8〜10秒）の同時取得数。開催中の約15会場を約50秒で終える */
export const POINT_RANK_CONCURRENCY = 3;

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx。targetDate は日次ジョブで解決済み）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runPointRankJob(
  ctx,
  { run = runPointRank, concurrency = POINT_RANK_CONCURRENCY } = {},
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");

  const result = await run(date, {
    client: ctx.client,
    fetchImpl: ctx.politeFetch,
    attempts: 1, // 再試行は politeFetch が行う
    concurrency,
    venueDelayMs: 0, // 同時数と1ページ約9秒で、取得先への負荷は十分に低い（約0.3リクエスト/秒）
    dryRun: ctx.mode === "shadow",
    shouldStop: ctx.shouldStop,
  });

  const report = {
    date,
    mode: ctx.mode,
    expectedVenues: result.expectedVenues,
    writtenVenues: result.writtenVenues,
    rowsParsed: result.rowsParsed,
    rowsWritten: result.count,
    venues: result.venues,
    venuesNotAttempted: result.venuesNotAttempted,
    failures: result.failures,
  };

  if (result.failures.length > 0) {
    return {
      outcome: "error",
      error: `得点率の取得に失敗（${result.failures.length}件）: ${result.failures.slice(0, 5).join(" / ")}`,
      rowsWritten: result.count,
      rowsExpected: result.expectedVenues,
      rowsParsed: result.rowsParsed,
      report,
    };
  }

  return {
    rowsWritten: result.count,
    rowsExpected: result.expectedVenues,
    rowsParsed: result.rowsParsed,
    // ソフトデッドラインで着手しなかった会場がある: 対象日を処理済みにせず、補足の起動がもう一度処理する
    incomplete: result.venuesNotAttempted.length > 0,
    report,
    body: {
      expectedVenues: result.expectedVenues,
      writtenVenues: result.writtenVenues,
      rowsParsed: result.rowsParsed,
      venuesNotAttempted: result.venuesNotAttempted,
    },
  };
}
