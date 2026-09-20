/**
 * 選手プロフィール・期別成績（B6、racer_profiles）の Vercel Cron（tasks.md T4b-16-1）。
 *
 * 約1,630人の選手について、期別成績（能力指数・フライング回数・出遅れ回数・公式勝率）を取得し、値が変わっている選手だけ
 * 更新する。racer_profiles 未登録の選手（直近の出走にいる新規選手）は、基本プロフィールも登録する。取得・解析・保存は、
 * 既存の scripts/lib/racerProfileSync.js（scripts/maintenance/scrape-racer-profiles.js の本体）を再利用する。
 *
 * 月次のチャンク処理: 1回の呼び出しは、時間の許す限り（最大300人）、登録番号の昇順に処理し、最後に処理した登録番号を
 * scrape_job_state.cursor に保存する。次の起動（10分後。実行中の起動は、リースで何もしない）が続きを処理し、全員を処理し終えたら、
 * 対象日を処理済みにする（それ以降の起動は、共通ラッパが何もしない）。1ページ約8〜10秒（2026-09-20の実測）のため、同時4で
 * 1回あたり約110人、全体で約15回（約2.5時間。窓は4時間）。実装: scripts/lib/racerProfilesJob.js
 *
 * maxDuration は300秒（設計の800秒ではない）: 800秒（Fluid Compute）が有効か未確認（plan.md U1）のため。無効なプロジェクトで
 * 800を指定すると、ビルドが失敗し、全てのデプロイを止める。300秒は、Proの既定の上限で、確実に通る。Fluid Compute を確認できたら、
 * 800に上げれば、回数が約1/3になる（レジストリの maxDurationSec・leaseSec も同じ値に）。
 *
 * モード（scrape_job_state.mode の job='racer_profiles'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（racer_profiles へ書かない）。cursor は shadow 専用（live は引き継がない）
 *   live                書き込む（GitHub Actions の scrape-racer-season-stats.yml と並走してよい。値が変わった選手だけ更新する）
 * GitHub側を止めるリポジトリ変数: SKIP_RACER_SEASON_ON_GHA=true（既定は未設定＝従来どおり実行）
 *
 * 手動の動作確認: GET /api/cron/racer-profiles?chunk=5（Authorization: Bearer {CRON_SECRET}）で、1回の処理人数を5人にする
 * （mode が shadow・live のとき。live の場合は、書き込みと cursor の前進を伴う）。
 *
 * cron式（vercel.json）はUTC。JST換算（毎月1日、5月・11月は8日・15日も。JST 09:00〜12:50、10分間隔）:
 *   分=10分刻み・UTC 0〜3時・毎月1日        毎月1日 09:00〜12:50 JST（vercel.json の crons を参照）
 *   分=10分刻み・UTC 0〜3時・5月11月の8日15日  5月・11月の8日・15日 09:00〜12:50 JST（審査切り替え直後のブースト）
 * レジストリ（racer_profiles.runDaysOfMonth）が、起動する日を持つ（scrape-monitor が、起動しない日の未処理を誤報しない）。
 *
 * maxDuration は、レジストリ（racer_profiles.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerProfilesJob } from "../../scripts/lib/racerProfilesJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "racer_profiles",
  run: (ctx) => runRacerProfilesJob(ctx),
});
