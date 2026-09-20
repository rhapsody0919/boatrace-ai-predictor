/**
 * 選手ニュース（B5、racer_news・racer_news_pending）の Vercel Cron（tasks.md T4b-15-1）。
 *
 * boatrace.jp 公式ニュースの「レーサーデータ」カテゴリ（当月・前月の一覧）から、選手の節目記録を検出し、登録番号による
 * racer_profiles の照合を通過したものを racer_news へ自動投入する（ADR-0024）。特定できなかった候補は、
 * DBの表 racer_news_pending（要確認リスト。docs/db-migration/080_racer_news_pending.sql）へ記録する
 * （従来は pending.json を git push。設計判断(i)）。読み手は scripts/maintenance/session-start-check.js。
 * 収集は、既存の scripts/lib/racerNews/officialGradeAnnouncements.js を再利用する。
 * 実装: scripts/lib/racerNewsJob.js
 *
 * モード（scrape_job_state.mode の job='racer_news'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析・照合のみ（racer_news・racer_news_pending へ書かない）
 *   live                書き込む（GitHub Actions の collect-racer-news.yml と並走してよい。処理済みの記事は、
 *                       racer_news・要確認リストとの照合で飛ばす）
 * GitHub側を止めるリポジトリ変数: SKIP_RACER_NEWS_ON_GHA=true（既定は未設定＝従来どおり実行）
 * live にする前に、マイグレーション080（racer_news_pending）を適用しておく（未適用のままでは、照合が失敗する）。
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `10 14 * * *`   23:10 JST
 *   `10 16 * * *`   翌 01:10 JST（補足。23:10 の実行が失敗・未配信だった場合のみ処理する。対象日は、指定時刻 23:10 から解決するため、
 *                   01:10 でも前日のまま）
 *
 * maxDuration は、レジストリ（racer_news.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerNewsJob } from "../../scripts/lib/racerNewsJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "racer_news",
  run: (ctx) => runRacerNewsJob(ctx),
});
