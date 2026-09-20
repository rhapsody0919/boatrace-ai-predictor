/**
 * 進入コース別選手成績（B4、venue_entry_course_stats）の Vercel Cron（tasks.md T4b-13-1）。
 *
 * 会場公式サイト（10会場）の進入コース別選手成績を、対象日の出走表（races・race_entries）がある会場ごとに取得し、
 * venue_entry_course_stats へ書く。取得・解析は、既存の scripts/daily/scrape-venue-entry-course-stats.js を再利用する。
 * 共通ラッパ経由で、対象日を「20:00 JST の指定時刻」から解決する（G2: 日付をまたぐと、まだ races の無い翌日を対象にして
 * 0件を保存していた問題の恒久対策）。会場ごとの成否履歴（構造変化の検知）は、git push をやめ、scrape_job_state.last_report へ。
 * 実装: scripts/lib/venueEntryCourseStatsJob.js
 *
 * モード（scrape_job_state.mode の job='entry_course_stats'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（venue_entry_course_stats へ書かない）
 *   live                書き込む（GitHub Actions の scrape-venue-entry-course-stats.yml と並走してよい。upsert で無害）
 * GitHub側を止めるリポジトリ変数: SKIP_ENTRY_COURSE_ON_GHA=true（既定は未設定＝従来どおり実行）
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `0 11 * * *`     20:00 JST
 *   `30 13 * * *`    22:30 JST（補足。20:00 の実行が完了しなかった＝一時的な失敗の会場・未配信の場合のみ、その会場を再取得する）
 *   `30 15 * * *`    翌 00:30 JST（補足。対象日は、指定時刻 20:00 から解決するため、00:30 でも前日のまま）
 *
 * maxDuration は、レジストリ（entry_course_stats.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runVenueEntryCourseStatsJob } from "../../scripts/lib/venueEntryCourseStatsJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "entry_course_stats",
  run: (ctx) => runVenueEntryCourseStatsJob(ctx),
});
