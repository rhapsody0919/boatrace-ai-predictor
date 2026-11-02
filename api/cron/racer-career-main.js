/**
 * 選手ページ（GS00 案2）の集計の表の main 層（2025-12-03〜）を毎晩計算し直す Vercel Cron（マイグレーション 190）。
 *
 * 直近3日に出走表に載った選手と、着のコードが直近3日に書き換わった選手について、main の全期間を
 * compute_racer_career_counts（service_role だけの RPC）で数え直し、4表へ upsertChangedRows で書く。
 * 差分を足す方式は取らない（重複配信で倍にならない・未配信は次の晩の3日の窓が拾う）。
 * 外部サイトへの通信は無い（DB の中の集計。ADR-0066 改訂1 の線引き）。
 * 設計: docs/design/racer-period-stats/plan.md §14、ADR-0104
 *
 * あわせて kb_archive の指紋（開催日・レースの数・最大の日付）を、kb 層の計算の記録（racer_career_meta）と比べる。
 * 変わっていたら、main の計算を書いた後で error にして知らせる（kb 層が古いまま。racer-career-backfill.js --era=kb を再実行する）。
 *
 * モード（scrape_job_state.mode の job='racer_career_main'）:
 *   off（または行なし）  何もしない
 *   shadow              数えるだけ（書かない）
 *   live                書く
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `30 14 * * *`  23:30 JST（その日の最終レースの後。前日分の着のコードは 07:00 の kfile_sync で入っている）
 *   `0 16 * * *`   01:00 JST（補足。23:30 が失敗・未配信・途中で打ち切りだった場合のみ処理する）
 *
 * 手動実行・初回の全選手の計算は CLI で行う:
 *   node scripts/maintenance/racer-career-backfill.js --era=main [--all] [--apply]
 *
 * maxDuration は、レジストリ（racer_career_main.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerCareerMainJob } from "../../scripts/lib/racerCareerJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "racer_career_main",
  run: async (ctx) =>
    runRacerCareerMainJob({
      client: ctx.client,
      today: ctx.targetDate,
      dryRun: ctx.mode !== "live",
      shouldStop: ctx.shouldStop,
      resume: ctx.state?.cursor ?? null,
    }),
});
