/**
 * 前検タイム・前検順位・節時点のモーター/ボート2連対率（N23、motor_pretest_stats）の Vercel Cron（tasks.md T4b-20）。
 *
 * 公式の race/rankingmotor を、対象日に開催のある会場（races）ごとに1ページ取得し、節の全選手（約45人）の前検タイム・
 * 前検順位（前検タイムから計算）・モーター/ボートの番号と2連対率を、motor_pretest_stats へ書く（変更のある行だけ）。
 * 取得・解析・書き込みは scripts/lib/motorPretestJob.js（過去分のCLI scripts/maintenance/motor-pretest-backfill.js と共有）。
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で、対象日を「05:20 JST の指定時刻」から解決する。
 *
 * モード（scrape_job_state.mode の job='motor_pretest'。DBの更新のみで切り替える。再デプロイ不要。既定は行なし＝off）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（motor_pretest_stats へ書かない）。last_report に会場ごとの件数・期待に対する充足を記録する
 *   live                書き込む（マイグレーション090の適用が前提。未適用なら、成功にせず失敗にする）
 * 旧基盤（GitHub Actions・cron-job.org）には、この取得は無い（新規のため、SKIP_*_ON_GHA は不要）。
 *
 * cron式（vercel.json）はUTC。JST換算（オッズの取得の運用窓 07:00〜23:59 JST の外に限る）:
 *   `30 20 * * *`  05:30 JST（races_init の完了後。前検は、前日の午後に終わっている）
 *   `0 21 * * *`   06:00 JST（補足。05:30 の実行が未完了＝races の未作成・一時的な失敗の会場がある場合のみ処理する。
 *                  完了済みなら、共通ラッパが last_target_date で何もしない）
 *   `30 21 * * *`  06:30 JST（補足。07:00 の前の最後の機会）
 *
 * maxDuration は、レジストリ（motor_pretest.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runMotorPretestJob } from "../../scripts/lib/motorPretestJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "motor_pretest",
  run: (ctx) => runMotorPretestJob(ctx),
});
