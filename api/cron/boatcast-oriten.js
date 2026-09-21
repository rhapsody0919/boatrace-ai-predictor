/**
 * BOATCASTのオリジナル展示（N25。一周/半周ラップ・まわり足・直線）の Vercel Cron（docs/design/boatcast-original-exhibition/plan.md）。
 *
 * 予定表（scrape_slots）の `boatcast_oriten` スロット（発走8分前を期限、許容幅30分、未公開（403）は最大3回まで再試行）を、
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。対象は、公開マップ（scripts/lib/boatcast/publicMap.js）で
 * 公開を確認済みの会場の全レースだけで、スロットも対象会場のレースにだけ作る（scripts/lib/boatcast/oritenJob.js の
 * createOritenStore）。取得・解析・書き込みは scripts/lib/boatcast/oritenJob.js（processOritenRace）。
 *
 * モード（scrape_job_state.mode。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。データテーブルへは書かず、予定表に result_digest を記録する
 *   live                race_original_exhibition・race_original_exhibition_values へ書く（マイグレーション087の適用後）。
 *                       内容が変わったときだけ書く
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   毎分、時は UTC 22〜23時・0〜14時 = JST 07:00〜23:59（他の窓型ジョブと同じ。監視の死活の判定（運用窓 07:10〜23:59）に合わせる）。
 *   最初のレースの期限（発走8分前）は08:20頃、最後のレースの3回目の取得は21:10頃で、それ以外の時間帯は空振り（予定表のスロットなし）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * Vercelから BOATCAST へ到達できるかの確認（調査時のアクセスは Vercel からではなかった。マージ後・shadow の前に実行する）:
 *   GET /api/cron/boatcast-oriten?probe=1[&race=YYYY-MM-DD-VV-RR]（Authorization: Bearer {CRON_SECRET}、mode が shadow・live のとき）
 *   既知の存在ファイル（bc_mst）を1件取り、HTTPステータス・Last-Modified・本文の先頭・リージョンを返す（書き込まない）。
 *   scripts/lib/boatcast/probe.js
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の boatcast_oriten.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:boatcast-job が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  ORITEN_JOB,
  createOritenSlotHandler,
  createOritenStore,
} from "../../scripts/lib/boatcast/oritenJob.js";
import { createBoatcastProbeHandler } from "../../scripts/lib/boatcast/probe.js";

export const config = {
  maxDuration: 90,
};

const cron = createScrapeCronHandler({
  job: ORITEN_JOB,
  handleSlot: createOritenSlotHandler(),
  createStore: createOritenStore,
});
const probe = createBoatcastProbeHandler();

export default async function handler(req, res) {
  if (req.query?.probe) return probe(req, res);
  return cron(req, res);
}
