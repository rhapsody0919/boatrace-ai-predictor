/**
 * 公式コンピュータ予想（B1、external_predictions）の Vercel Cron（tasks.md T4b-08-2、plan.md §4.2(c)・§3.6）。
 *
 * 予定表（scrape_slots）の `pcexpect` スロット（発走の12時間前を期限に、許容幅690分＝発走30分前まで。失敗・未公開は
 * 600秒おきに再試行）を、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。1回の起動は、最大20件を
 * 3並列で処理する（1レース約10秒＝実測のため、約75秒）。取得・解析・書き込みは、既存の
 * scripts/daily/scrape-pcexpect.js（runForRaces）を再利用する（CLIと解析・書き込みを共有）。
 *
 * 公式予想は、朝の1回の取得で足りる（2026-09-21の実測: 朝02:25に保存した payload と、8.5時間後の再取得が、
 * 未発走の3レースで完全一致。plan.md U7）。予定表のスロットは、レースごとに1本で、完了（ok）したら再取得しない。
 *
 * モード（scrape_job_state.mode の job='pcexpect'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。external_predictions へは書かず、予定表に result_digest（payload のダイジェスト）を記録する
 *   live                external_predictions へ書き込む（GitHub Actions の morning-init の pcexpect と並走してよい。upsert で無害）
 * GitHub側を止めるリポジトリ変数: SKIP_PCEXPECT_ON_GHA=true（morning-init.js の pcexpect の段。既定は未設定＝従来どおり実行）
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `*\/5 20-23,0-14 * * *`  5分ごと、JST 05:00〜23:59
 * 朝の初期化（races-init）が 05:00 JST に races を作るため、その直後から消化する（公式予想は静的で、早いほど余裕がある。
 * 全スロットが済んだ後の起動は、期限の来たスロットが無く、何も書かない）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の pcexpect.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:morning-init-jobs が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createPcexpectSlotHandler } from "../../scripts/lib/scrapeJobs/pcexpectHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "pcexpect",
  handleSlot: createPcexpectSlotHandler(),
});
