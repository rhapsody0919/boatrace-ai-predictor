/**
 * 汎用の日次監視 data_health の Vercel Cron（完了の定義C。tasks.md T7-06、verification-runbook.md U）。
 *
 * データ健全性（件数の充足率・0件のテーブル）を、DBの実測から日次で自動計測し、閾値未達を Slack へ通知する。
 * 登録表: scripts/lib/dataHealth/checks.js。SQL（データセットごとの固定の関数）: scripts/lib/dataHealth/functions.js
 * （マイグレーション089）。判定: evaluate.js。実行: job.js。
 *
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で、対象日を「06:30 JST の指定時刻」から解決する。
 * DB読み取りのみ。書き込みは scrape_job_state（job='data_health'）の last_report（結果・通知・状態）だけ。
 * 通知は last_report.alerts → scrape-monitor（api/cron/scrape-monitor.js）が、既存のSlack通知に流す。
 *
 * モード（scrape_job_state.mode の job='data_health'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何もしない
 *   shadow              判定と last_report への記録のみ（通知は出さない。出すはずだった内容は last_report.wouldAlert）
 *   live                閾値未達を通知する
 * マイグレーション089が未適用のDBでは、関数の呼び出しが失敗し、実行の失敗として記録される
 * （off のまま089を適用してから shadow → live にする）。
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `35 21-23 * * *`  06:35・07:35・08:35 JST（06:35が本番、07:35・08:35は補足。処理済みなら、
 *                     共通ラッパが last_target_date で何もしない）
 *
 * maxDuration は、レジストリ（data_health.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runDataHealthJob } from "../../scripts/lib/dataHealth/job.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "data_health",
  run: (ctx) => runDataHealthJob(ctx),
});
