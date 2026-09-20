/**
 * データ取得の監視（Vercel Cron、完了の定義C）。plan.md §7・tasks.md T4a-09。
 *
 * 5分ごと（運用窓 JST 07:00〜23:59）: 予定表・ジョブ状態を計測し、閾値超過（expired・未実行・窓内取得率・
 * 死活・連続失敗・ブレーカー・日次ジョブの期限超過）を、SLACK_WEBHOOK_URL へ通知する。
 * 日次サマリー（JST 00:10）は、別のエンドポイント api/cron/scrape-summary.js。
 *
 * 予定表のテーブルが無い（マイグレーション072が未適用）間、および取得ジョブが1つも有効でない間は、
 * 何も通知しない。実行の成否は scrape_job_state（job='scrape-monitor'）に記録される
 * （メタ監視 .github/workflows/scrape-monitor-liveness.yml がその鮮度を日次で確認する）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（Vercel Cron は CRON_SECRET が設定されていれば自動で付ける）
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runMonitor } from "../../scripts/lib/scrapeJobs/monitor.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "scrape-monitor",
  run: (ctx) => runMonitor(ctx),
});
