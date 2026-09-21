/**
 * 朝の初期化（A8、races・race_entries・predictions の初期化）の Vercel Cron（tasks.md T4b-07-4、plan.md §4.2）。
 *
 * その日の開催会場（race/index?hd=）を取得し、会場ごとに出走表・直前情報・発走時刻を取得して、races・race_entries・
 * exhibition_data・predictions・race_conditions へ書く（従来の morning-init.js の scrape-to-json.js →
 * generate-predictions.js に相当）。全会場が済んだら、予定表（scrape_slots）の生成・unified予測・Deploy Hook を行い、
 * 対象日を処理済みにする。会場を数件ずつのチャンクで処理し、進捗は scrape_job_state.cursor に保存して、次の起動（2分後）が
 * 続きを処理する。実装: scripts/lib/racesInit/job.js（動作の詳細はそちらの冒頭）。
 * 共通ラッパ経由で、対象日を「05:00 JST の指定時刻」から解決する（GitHub Actionsの遅延起動で日付を取り違える問題の恒久対策）。
 * 公式コンピュータ予想（pcexpect）は、別のジョブ（api/cron/pcexpect.js。予定表のスロット）に分けた。
 *
 * 予測ロジックの変更検知による再生成（従来の `git log` 依存）は、ソースの内容ハッシュに置き換えた（onTick。live のみ、
 * 起動のたびに。scripts/lib/racesInit/predictCodeCheck.js）。
 *
 * モード（scrape_job_state.mode の job='races_init'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、何も書かない
 *   shadow              取得・解析のみ（races 等へ書かない）。レースごとのダイジェストを cursor に記録する
 *                       （既存基盤が書いた値との一致率を、scripts/maintenance/check-morning-init-shadow.js で測る）
 *   live                書き込む。既に races に行のある会場（GitHub Actions の morning-init が初期化済み）は、処理しない
 * GitHub側を止めるリポジトリ変数: SKIP_MORNING_INIT_ON_GHA=true（scrape-scheduled.yml の Morning initialization の段。
 * 既定は未設定＝従来どおり実行）。ただし、フェイルセーフとして、JST 07:00 になっても当日の races が1件も無ければ、
 * GitHub側が従来どおり初期化する（Vercelが失敗した日に、誰も初期化しない状態を避ける。scripts/lib/racesInit/ghaSkip.js）。
 * pcexpect だけを先に止める変数は SKIP_PCEXPECT_ON_GHA=true
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `*\/2 20-23,0-14 * * *`  2分ごと、JST 05:00〜23:58
 * 従来（07:00開始、初回の完了が07:35頃）より2時間早め、最初の発走の窓（発走60分前）に十分な余裕を持たせる
 * （設計判断(f)）。処理済みの日は、共通ラッパが朝の初期化をせず、予測ロジックの変更検知（onTick。ハッシュの比較のみ）だけを行う。
 * 変更検知を終日にするため、cron は 23:58 まで動かす（従来のGitHub版は5分ごと・終日。2026-09-21、ユーザーが承認）。
 *
 * 手動の動作確認: GET /api/cron/races-init?venues=N（Authorization: Bearer {CRON_SECRET}）で、1回の呼び出しで処理する
 * 会場数を N にする（mode が shadow・live のとき。live の場合は、書き込みと cursor の前進を伴う）。
 *
 * maxDuration は、レジストリ（races_init.maxDurationSec）と同じ値をリテラルで書く。
 * 800秒は Pro＋Fluid Compute の上限（2026-09-21、ユーザーがダッシュボードで Fluid Compute の有効を確認）。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  createPredictCodeOnTick,
  runRacesInitJob,
} from "../../scripts/lib/racesInit/job.js";

export const config = {
  maxDuration: 800,
};

export default createScrapeCronHandler({
  job: "races_init",
  run: (ctx) => runRacesInitJob(ctx),
  onTick: createPredictCodeOnTick(),
});
