/**
 * Kファイル同期（進入コース・rank4〜6）の Vercel Cron（tasks.md T4b-05-1、plan.md §4.1）。
 *
 * 公式成績ファイル（Kファイル、www1.mbrace.or.jp。LZH圧縮）から、当日を除く直近4日について、
 * race_results.actual_course_1〜6 と rank4〜6 を補完する。従来は結果取得（scrape-results.js）の中で、
 * 同じ日のKファイルを2つの同期が別々にダウンロードしていた（D4）。ここでは1日1回のダウンロードで両方を処理する。
 * 未同期のレースが無い日は、ダウンロードしない。BOA-349の修正（変更のある行だけ書く）を維持する
 * （scripts/daily/scrape-results.js の syncActualCourseFromKFile・syncRank456FromKFile）。
 *
 * モード（scrape_job_state.mode の job='kfile_sync'）: off なら何もしない。shadow は dryRun（Kファイルの取得・解析と、
 * 書くはずの件数の集計のみ。書き込まない）。live は書き込む（GitHub Actions側の同期と並走してよい。同じ値の上書きで、
 * 変更のある行だけ書くため無害）。
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `0 22 * * *`  07:00 JST（Kファイルは開催日の夜〜翌日に公開される）
 *   `0 3 * * *`   12:00 JST（補足。07:00の実行が完了しなかった＝未公開・失敗の場合のみ処理する。
 *                  完了済みなら、共通ラッパが last_target_date で何もしない）
 *
 * 未確認（plan.md U15）: Kファイルの展開（@kirinsaninc/lhats、純JS）がVercel関数の中で動くか。通常の実行は、未同期の
 * レースが無い日はダウンロードしないため、確認には手動リクエストの probe を使う:
 *   GET /api/cron/kfile-sync?probeDate=YYYY-MM-DD（Authorization: Bearer {CRON_SECRET}、mode が shadow・live のとき）
 * その日のKファイルをダウンロード・展開・解析して、レース数を返すだけ（書き込み・同期なし）。
 *
 * maxDuration は、レジストリ（kfile_sync.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createKFileSyncRun } from "../../scripts/lib/scrapeJobs/resultHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "kfile_sync",
  run: createKFileSyncRun(),
});
