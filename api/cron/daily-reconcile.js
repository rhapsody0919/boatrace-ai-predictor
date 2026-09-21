/**
 * 日次の照合（N29、daily_reconcile）の Vercel Cron（tasks.md T4b-21）。完了の定義Cの独立した突合先。
 *
 * 前日（D）の結果・払戻・着順・進入を、DB（races・race_results・race_payouts）と、公式のKファイル（競走成績。
 * www1.mbrace.or.jp。LZH）で突き合わせ、不一致（レースID・項目・DB値・K値）を last_report に上限つきで残し、閾値以上で
 * Slack（scrape-monitor の last_report.alerts）に通知する。書き込みは無い。新しい取得先・テーブルは無い（Kファイルは既存。
 * kfile_sync と同じ取得・展開・解析）。実装: scripts/lib/dailyReconcileJob.js・dailyReconcile.js
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で、対象日を「07:50 JST の指定時刻」から解決し、その前日を照合する。
 *
 * モード（scrape_job_state.mode の job='daily_reconcile'。DBの更新のみで切り替える。再デプロイ不要。既定は行なし＝off）:
 *   off（または行なし）  何もしない
 *   shadow              照合して last_report に記録する（通知は出さない。would_alert に記録）。対象日は処理済みにしない
 *   live                通知を出す。対象日を処理済みにする
 * 旧基盤には、この照合は無い（新規のため、SKIP_*_ON_GHA は不要）。
 *
 * cron式（vercel.json）はUTC。JST換算（kfile_sync の 07:00・12:00 JST の後）:
 *   `0 23 * * *`   08:00 JST（前日分。Kファイル同期の07:00の後）
 *   `30 3 * * *`   12:30 JST（補足。08:00 の照合で、照合不能・同期待ちが残った場合のみ処理する。kfile_sync の12:00の後。
 *                  完了済みなら、共通ラッパが last_target_date で何もしない）
 *   `30 8 * * *`   17:30 JST（最後の照合。同期待ちを不一致に数え、照合不能を通知して、対象日を処理済みにする）
 *
 * maxDuration は、レジストリ（daily_reconcile.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runDailyReconcileJob } from "../../scripts/lib/dailyReconcileJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "daily_reconcile",
  run: (ctx) => runDailyReconcileJob(ctx),
});
