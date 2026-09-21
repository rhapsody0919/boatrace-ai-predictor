/**
 * レース情報更新（A1）の Vercel Cron（tasks.md T4b-09-2、plan.md §3.6・§4.1・§5）。
 *
 * 予定表（scrape_slots）の `race_info` スロット（発走60分前を期限に、許容幅3分。失敗・選手情報なしは60秒おきに再試行）を、
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。取得・解析・書き込みは、既存の
 * scripts/daily/update-race-info.js（runForRaces）を再利用する（GitHub Actions・CLIと解析・行の組み立てを共有）。
 * 出走表（racelist）だけを取り、直前情報（beforeinfo）は展示（api/cron/exhibition.js）が全項目を取る（D2の解消。
 * 気象は展示の取得時の値）。race_entries・race_conditions（節・レース名）・races（race_grade・締切予定時刻による
 * start_time の日中追従・中止・順延の暫定検知）を、変更のある行だけ書く。
 *
 * 予測の再計算（案1）: REFRESH_ON_VERCEL=true のとき、変更を書いたレースについて、全スロットの完了後に、mainRefresh を
 * 1回呼ぶ（既定は off＝再計算しない）。GitHub Actions 側の再計算との併走の防止は、scripts/lib/predictionRefresh.js を参照。
 *
 * モード（scrape_job_state.mode の job='race_info'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。データテーブルへは書かず、予定表に result_digest を記録する
 *   live                データテーブルへ書き込む（GitHub Actions 側のレース情報更新と並走してよい。上書き型で無害）
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `* 22-23,0-14 * * *`  毎分、JST 07:00〜23:59
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の race_info.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:scrape-pre-race-job が一致を検査する。
 */
import {
  createRaceInfoSlotHandler,
  createRefreshingCronHandler,
} from "../../scripts/lib/scrapeJobs/preRaceHandlers.js";

export const config = {
  maxDuration: 180,
};

export default createRefreshingCronHandler({
  job: "race_info",
  createHandleSlot: (collector) =>
    createRaceInfoSlotHandler({ onChanged: collector.onChanged }),
});
