/**
 * レース特記事項取得（Vercel Function版、FR-1、BOA-353 T4b-11）
 *
 * scripts/daily/scrape-race-information.js の run(schedule, date) を、共通ラッパ
 * （scripts/lib/scrapeJobs/cronWrapper.js）経由で呼ぶ。ロジックは一切複製しない。
 * ラッパへの接続は scripts/lib/raceNoticesJob.js。
 *
 * 起動元: Vercel Cron（vercel.json の crons、10分間隔。UTCの22〜23時・0〜14時台＝JST 07:00〜23:59）。
 * 移行期間は、cron-job.org（10分間隔）も同じエンドポイントを叩く。ジョブ単位のリースで、同時に1つだけ
 * 走り、書き込みは重複を無視する upsert と、変更のある行のみの集計行のため、二重に起動されても無害。
 * cron-job.org の停止は、Vercel Cron での稼働を確認した後、ユーザーが行う（verification-runbook.md G）。
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
