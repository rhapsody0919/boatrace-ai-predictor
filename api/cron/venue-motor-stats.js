/**
 * 会場別モーター成績（B3、venue_motor_stats）の Vercel Cron（tasks.md T4b-14-1）。
 *
 * 会場公式サイト（22会場。戸田・平和島はデータなしで対象外。宮島はPDF）のモーター成績を取得し、venue_motor_stats へ
 * 書く（scraped_date は対象日）。取得・解析は、既存の scripts/daily/scrape-venue-motor-stats.js を再利用する。
 * 共通ラッパ経由で、対象日を「06:00 JST の指定時刻」から解決する。会場ごとの成否履歴（構造変化の検知）は、
 * git push（BOA-360 の競合の原因）をやめ、scrape_job_state.last_report へ。
 * 実装: scripts/lib/venueMotorStatsJob.js
 *
 * 取得先への負荷（ADR-0067）: 会場は別ドメイン。同時4会場、各ドメインへ1日1〜2リクエスト。politeFetch
 * （タイムアウト・429/503のバックオフ・会場サイトごとのブレーカー）を通す。
 *
 * モード（scrape_job_state.mode の job='venue_motor_stats'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（venue_motor_stats へ書かない）
 *   live                書き込む（GitHub Actions の scrape-venue-motor-stats.yml と並走してよい。upsert で無害）
 * GitHub側を止めるリポジトリ変数: SKIP_MOTOR_STATS_ON_GHA=true（既定は未設定＝従来どおり実行）
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `0 21 * * *`   06:00 JST（本日のレース開始前）
 *   `0 23 * * *`   08:00 JST（補足。06:00 の実行が完了しなかった＝一時的な失敗の会場・未配信の場合のみ、その会場を再取得する）
 *
 * maxDuration は、レジストリ（venue_motor_stats.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runVenueMotorStatsJob } from "../../scripts/lib/venueMotorStatsJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "venue_motor_stats",
  run: (ctx) => runVenueMotorStatsJob(ctx),
});
