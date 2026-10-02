/**
 * レース特記事項取得（Vercel Function版、FR-1、BOA-353 T4b-11）
 *
 * scripts/daily/scrape-race-information.js の run(schedule, date) を、共通ラッパ
 * （scripts/lib/scrapeJobs/cronWrapper.js）経由で呼ぶ。ロジックは一切複製しない。
 * ラッパへの接続は scripts/lib/raceNoticesJob.js。
 *
 * 起動元: Vercel Cron（vercel.json の crons）。夜1回の日次ジョブ（2026-10-03 にユーザー承認で、10分ごとから変更。
 * ページに事故がほとんど載らず、1日約1,300回の取得に見合わないため）。cron式はUTC:
 *   UTC 13:30 ＝ JST 22:30（指定時刻。その日の開催会場を全部取る）
 *   UTC 14:00・14:30 ＝ JST 23:00・23:30（補足。取得に失敗した・着手しなかった会場があった場合だけ処理する。
 *   処理済みなら last_target_date で何もしない）
 * cron-job.org（10分間隔）が残っていても、指定時刻より前の起動は前日（処理済み）に解決され、何もしない。
 * ジョブ単位のリースで同時に1つだけ走り、書き込みは重複を無視する upsert のため、二重に起動されても無害。
 *
 * 10分ごとに戻すとき: registry.js の race_notices を kind:"continuous"（targetTimeJst を外す）に、vercel.json の
 * 3本を、変更前の10分間隔の1本（10分ごと、UTC 22〜23時・0〜14時台。git の履歴の変更前の値）に戻し、raceNoticesJob.js の incomplete を外す（PR の本文に手順）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET} ヘッダーが一致しない限り拒否する（ラッパ）。
 * mode: scrape_job_state（job='race_notices'）の mode を毎回DBから読む。off（または行なし）は何もしない。
 *   shadow は取得・解析のみ（DBへ書かない）。live で書き込む。切り替えはDBの更新のみ（再デプロイ不要）
 *
 * 応答: 従来（waitUntil で即時に 202）と違い、処理の完了後に 200/500 を返す。失敗（DB障害・全会場の取得失敗）は
 * 500 になり、scrape_job_state の last_error・consecutive_failures に残る（連続失敗は scrape-monitor が通知）。
 * 処理時間は、会場数×約8〜10秒÷6並列（13〜24会場で約20〜60秒）。cron-job.org のタイムアウト（30秒）を超える
 * 日は、cron-job.org 側だけが失敗と表示する（関数は完走する）。
 *
 * maxDuration は registry.js の race_notices.maxDurationSec と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRaceNoticesJob } from "../../scripts/lib/raceNoticesJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "race_notices",
  run: runRaceNoticesJob,
});
