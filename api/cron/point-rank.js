/**
 * 得点率（B2、racer_series_points）の Vercel Cron（tasks.md T4b-12-1、plan.md §4.3）。
 *
 * boatrace.jp の pointrank を、対象日に開催中の会場ごとに取得し、racer_series_points へ書く。取得・解析・判定は、既存の
 * scripts/daily/scrape-point-rank.js（run）を再利用する（GitHub Actions・CLIと共有）。
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で、対象日を「22:00 JST の指定時刻」から解決する
 * （G1: GitHub Actionsの遅延起動で、対象日が翌日になって0件を書いていた問題の恒久対策。BOA-364・BOA-291）。
 * 実装: scripts/lib/pointRankJob.js
 *
 * モード（scrape_job_state.mode の job='point_rank'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（racer_series_points へ書かない）。last_report に会場ごとの行数を記録する
 *   live                書き込む（GitHub Actions の scrape-point-rank.yml と並走してよい。upsert で無害）
 * GitHub側を止めるリポジトリ変数: SKIP_POINT_RANK_ON_GHA=true（scrape-point-rank.yml。既定は未設定＝従来どおり実行）
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `0 13 * * *`      22:00 JST（当日の全レース結果の確定後）
 *   `30 14,16 * * *`  23:30・翌 01:30 JST（補足。22:00 の実行が失敗・未配信だった場合のみ処理する。処理済みなら、
 *                     共通ラッパが last_target_date で何もしない。対象日は、指定時刻 22:00 から解決するため、01:30 でも前日のまま）
 *
 * maxDuration は、レジストリ（point_rank.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runPointRankJob } from "../../scripts/lib/pointRankJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "point_rank",
  run: (ctx) => runPointRankJob(ctx),
});
