/**
 * 予定表の保守（Vercel Cron、日次 JST 04:00）。plan.md §3.9・tasks.md T4a-11。
 *
 * 2日以上前の未完了スロットを expired にし、保持期間（60日）を過ぎた行を削除する。
 * 予定表のテーブルが無い（マイグレーション072が未適用）間は、何もしない。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runCleanup } from "../../scripts/lib/scrapeJobs/cleanup.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "scrape-cleanup",
  run: (ctx) => runCleanup(ctx),
});
