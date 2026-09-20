/**
 * データ取得の日次サマリー（Vercel Cron、日次 JST 00:10）。plan.md §7・tasks.md T4a-09。
 *
 * scrape-monitor と同じ監視を、日次サマリー（前日と直近7日の窓内取得率・遅延・expired・未実行・モード）の
 * 投稿つきで実行する。cronのクエリ文字列（?mode=daily）に依存しないよう、別のエンドポイントにしている。
 * 取得ジョブが1つも有効でない間、およびマイグレーション072の適用前は、何も投稿しない。
 * ジョブ状態は scrape-monitor と同じ行（job='scrape-monitor'）を使う（通知済みの記録を共有する）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runMonitor } from "../../scripts/lib/scrapeJobs/monitor.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "scrape-monitor",
  run: (ctx) => runMonitor({ ...ctx, query: { ...ctx.query, mode: "daily" } }),
});
