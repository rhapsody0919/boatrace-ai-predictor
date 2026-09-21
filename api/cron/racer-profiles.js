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
 * 1回あたり約300人（maxDuration 800秒）、全体で約6回（約1時間。窓は3時間・18回の起動）。実装: scripts/lib/racerProfilesJob.js
 *
 * maxDuration は800秒（Pro＋Fluid Compute の上限。2026-09-20、ユーザーがダッシュボードで Fluid Compute の有効を確認）。
 * 同時4・1ページ約8〜10秒で、1回あたり約300人（RACER_PROFILES_CHUNK の上限）を処理でき、全体で約6回（約1時間）で終わる。
 * レジストリの maxDurationSec・leaseSec も同じ値にする。
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
 * cron式（vercel.json）はUTC。従来のGitHub Actions（scrape-racer-season-stats.yml。UTC 18:00＝JST 03:00）と同じ夜間・同じ日付（vercel.json の crons を参照）:
 *   UTC 毎月1日 18:00〜20:50（10分間隔）＝ JST 毎月2日 03:00〜05:50（最後のチャンクの終了は 05:55 頃）
 *   UTC 5月・11月の8日・15日 18:00〜20:50（10分間隔）＝ JST 9日・16日 03:00〜05:50（審査切り替え直後のブースト）
 * 夜間にする理由: 各チャンクの開始時に選手一覧・直近の出走（race_entries 約34ページ）を読むDB負荷を、開催時間帯（9:00〜21:00 JST）
 * から避けるため（GitHub側の設計と同じ）。日付は、UTC 18時台が JST では翌日のため、JST では2日（5月・11月は9日・16日も）。
 * レジストリ（racer_profiles.runDaysOfMonth）は、JST の日で持つ（scrape-monitor が、起動しない日の未処理を誤報しない）。
 *
 * maxDuration は、レジストリ（racer_profiles.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerProfilesJob } from "../../scripts/lib/racerProfilesJob.js";

export const config = {
  maxDuration: 800,
};

export default createScrapeCronHandler({
  job: "racer_profiles",
  run: (ctx) => runRacerProfilesJob(ctx),
});
