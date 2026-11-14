/**
 * 決まり手・逃げの分布の集計2本（BOA-1479 ZB15）の Vercel Cron。
 *
 * outcome_distribution（会場×(1着,2着,3着)の出現）と nige_outcome_distribution
 * （逃げ成功レースに絞った同じ集計）を、過去90日の race_results から作り直す。
 * 外部サイトへの通信は一切しない。2本を続けて回す。
 * 実測の実行時間は shadow の last_report で確かめる（maxDuration 300 秒の半分以内が目安）。
 *
 * ## なぜこの時刻か（plan.md §2.4 と同じ理屈）
 *
 * 集計の材料の `race_results` は Kファイル同期（api/cron/kfile-sync.js、
 * 07:00 / 12:00 JST = 22:00 / 03:00 UTC）が書き、Kファイルは「開催日の夜〜翌日」公開のため、
 * **前日ぶんが埋まるのは当日 07:00 JST**。GitHub 側の 15:30 / 15:42 UTC（00:30 / 00:42 JST）は
 * これより前で、前日分が入らないまま集計していた。そこで kfile-sync の各回の30分後に置く:
 *   `30 22 * * *`  07:30 JST（kfile_sync 07:00 の後）
 *   `30 3 * * *`   12:30 JST（補足。kfile_sync 12:00 の後。07:30 が失敗・未配信だった場合の自己修復も兼ねる）
 * 集計は毎回 delete→insert で作り直すので、何度走っても結果は同じ（冪等）。
 *
 * 現行の GitHub Actions（update-outcome-distribution.yml・update-nige-outcome-distribution.yml）は
 * 並走して一致を見るため残す。消すのは、shadow で一致を見てオーナーが行を live にした後の別の票。
 *
 * モード（scrape_job_state.mode の job='outcome_distribution_update'）:
 *   off（または行なし）  何もしない
 *   shadow              集計のみ（2表へ書かない）
 *   live                書き込む
 *
 * 手動実行は CLI で行う:
 *   node scripts/daily/update-outcome-distribution.js [--dry-run]
 *   node scripts/daily/update-nige-outcome-distribution.js [--dry-run]
 *
 * maxDuration は、レジストリ（outcome_distribution_update.maxDurationSec）と同じ値を
 * リテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runOutcomeDistribution } from "../../scripts/daily/update-outcome-distribution.js";
import { runNigeOutcomeDistribution } from "../../scripts/daily/update-nige-outcome-distribution.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "outcome_distribution_update",
  run: async (ctx) => {
    const dryRun = ctx.mode !== "live";
    const outcome = await runOutcomeDistribution({ dryRun });
    const nige = await runNigeOutcomeDistribution({ dryRun });
    return {
      outcome: "ok",
      rowsWritten: (outcome.rowsWritten ?? 0) + (nige.rowsWritten ?? 0),
      // 定数1: 「集計結果が1行以上あるはず」。0件なら共通ラッパの0件ガードが error にする
      rowsExpected: 1,
      rowsParsed: (outcome.rowsParsed ?? 0) + (nige.rowsParsed ?? 0),
      report: { outcome: outcome.report, nige: nige.report },
    };
  },
});
