/**
 * ピットレポート（選手コメント。N24、BOA-379）の Vercel Cron（docs/design/pit-comments/plan.md）。
 *
 * 予定表（scrape_slots）の `pit_reports` スロット（発走60分前〜発走+180分、未公開は300秒おきに再試行）を、
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。対象はSG（全レース）・G1・G2（7R以降）のレース
 * だけで、スロットも対象レースにだけ作る（scripts/lib/pitReportJob.js の createPitReportStore）。
 * 取得・解析・書き込みは scripts/lib/pitReportJob.js（processPitReportRace。バックフィルCLIと共有）。
 *
 * モード（scrape_job_state.mode。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。データテーブル・Storageへは書かず、予定表に result_digest を記録する
 *   live                race_pit_comments・race_pit_reports へ書く（マイグレーション085の適用後）。内容が変わったときだけ書き、
 *                       生HTMLをStorageへ保管する
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   5分間隔（分の指定は 0,5,...,55）、時は UTC 22〜23時・0〜15時 = JST 07:00〜翌 00:55
 * 最終レースの発走は22:41〜22:45 JST（SGのナイターは20:40台）で、その発走+数十分まで再試行するため、結果と同じく 00:55 まで延ばす。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の pit_reports.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:pit-report-job が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  PIT_REPORT_JOB,
  createPitReportSlotHandler,
  createPitReportStore,
} from "../../scripts/lib/pitReportJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: PIT_REPORT_JOB,
  handleSlot: createPitReportSlotHandler(),
  createStore: createPitReportStore,
});
