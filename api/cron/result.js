/**
 * 結果取得（A6）の Vercel Cron（tasks.md T4b-02-2、plan.md §3.6・§4.1）。
 *
 * 予定表（scrape_slots）の `result` スロット（発走+5分〜+90分、失敗・未公開は300秒おきに再試行）を、共通ラッパ
 * （scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。取得・解析・書き込みは、既存の
 * scripts/daily/scrape-results.js（runForRaces）を再利用する（GitHub Actions・CLIと解析・書き込みを共有）。
 *
 * モード（scrape_job_state.mode。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。データテーブルへは書かず、予定表に result_digest を記録する
 *   live                データテーブルへ書き込む（GitHub Actions側の結果取得と並走してよい。上書き型で無害）
 *
 * 毎分の起動ごとに、スロットの取得の前に onTick で、発走+90分を超えて結果の無いレースを、中止・順延「確定」にする
 * （live のみ）。スロットの期限切れ（expired）より先に確定させ、中止・順延のレースが「取得の失敗」として
 * 通知されないようにする。
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `* 22-23,0-15 * * *`  毎分、JST 07:00〜翌 00:59
 * 運用窓の他のジョブは 23:59 までだが、最終レースの発走は 22:41〜22:45 JST で、その結果の許容幅（+90分）は
 * 翌 00:15 に及ぶため、結果だけ 00:59 まで延ばす（plan.md §2.3の注記）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の result.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:scrape-result-job が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  createResultOnTick,
  createResultSlotHandler,
} from "../../scripts/lib/scrapeJobs/resultHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "result",
  handleSlot: createResultSlotHandler(),
  onTick: createResultOnTick(),
});
