/**
 * 選手ニュース（B5、racer_news・racer_news_pending）の共通ラッパ向けハンドラー（tasks.md T4b-15-1）。
 * api/cron/racer-news.js が createScrapeCronHandler の run に渡す。
 *
 * 従来（GitHub Actions の collect-racer-news.yml）との違い:
 *   - 要確認リスト（選手の特定に失敗した候補）: data/analysis/racer-news-pending-review/pending.json の git push をやめ、
 *     DBの表 racer_news_pending（docs/db-migration/080_racer_news_pending.sql）に書く（設計判断(i)）。
 *     読み手（scripts/maintenance/session-start-check.js・.claude/rules/content-ops.md フローC-4）も、この表を読む
 *   - 対象日: 共通ラッパが「23:10 JST の指定時刻」から解決した ctx.targetDate（01:10 JST の補足の起動も同じ対象日）。
 *     取得する一覧は、対象日の当月と前月
 *   - 取得: politeFetch（15秒タイムアウト・429/503のバックオフ・サーキットブレーカー）
 *   - 失敗: 一覧の取得失敗・記事の処理の失敗は、実行の失敗（outcome:"error"）。対象日を処理済みにせず、補足の起動が再試行する
 *     （処理済みの記事は、racer_news・要確認リストとの照合で飛ばすため、再試行は冪等）
 *   - mode: shadow は取得・解析・照合のみ（racer_news・racer_news_pending へ書かない）。off は何もしない
 */
import { collectGradeAnnouncementNews } from "./racerNews/officialGradeAnnouncements.js";
import { createDbPendingStore } from "./racerNews/pendingReview.js";

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runRacerNewsJob(
  ctx,
  { collect = collectGradeAnnouncementNews } = {},
) {
  const date = ctx.targetDate;
  const summary = await collect({
    targetDate: date,
    client: ctx.client,
    fetchImpl: ctx.politeFetch,
    pendingStore: createDbPendingStore(ctx.client),
    dryRun: ctx.mode === "shadow",
  });

  const report = { date, mode: ctx.mode, ...summary };
  if (summary.errors > 0) {
    return {
      outcome: "error",
      error: `選手ニュースの収集でエラーが${summary.errors}件ありました（生成${summary.generated}件・要確認${summary.pending}件・スキップ${summary.skipped}件。詳細は関数のログ）`,
      // 生成・要確認に追加できた分は書き込み済み
      rowsWritten:
        ctx.mode === "live" ? summary.generated + summary.pending : 0,
      report,
    };
  }

  return {
    rowsWritten: ctx.mode === "live" ? summary.generated + summary.pending : 0,
    report,
    body: report,
  };
}
