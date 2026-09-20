/**
 * 疑似ジョブ（tasks.md T4a-10 の検証用）。取得先へアクセスせず、予定表のスロットを消化するだけ。
 *
 * 共通ラッパ・予定表を、実環境（Vercel＋本番DB）で、重複配信・二重claim・リースの奪取・期限計算
 * （JST）・モードの切り替え（環境変数の再デプロイなしの反映）について検証するために使う。
 * 手順は docs/design/scraping-vercel-consolidation/verification-runbook.md。
 *
 * - Cron には登録しない。手動リクエスト（Authorization: Bearer {CRON_SECRET}）のみ
 * - scrape_job_state の job='pseudo' の行が無い、または mode='off' の間は、何もしない
 * - ?sleepMs=N（最大40000）: 1スロットの処理時間を延ばす（同時に2件のリクエストを送り、二重claimが
 *   起きないことを確認するため）
 * - リースは20秒（レジストリ）。?sleepMs=25000 のように、リースより長く処理すると、別の実行がリースを奪取する
 * - 検証が終わったら、このファイルと registry.js の pseudo を削除してよい
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "pseudo",
  handleSlot: async (slot, ctx) => {
    const sleepMs = Math.min(
      Math.max(Number(ctx.query?.sleepMs ?? 0) || 0, 0),
      40000,
    );
    if (sleepMs > 0)
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    return {
      outcome: "ok",
      rowsWritten: 0,
      // どの実行が、何回目の試行で処理したかを、予定表から追えるようにする
      // SCRAPE_PSEUDO_PROBE: 環境変数の変更が、再デプロイなしに反映されるか（plan.md U17）の確認用
      resultDigest: `pseudo:${ctx.worker}:attempt${slot.attempts}:probe=${process.env.SCRAPE_PSEUDO_PROBE ?? ""}`,
    };
  },
});
