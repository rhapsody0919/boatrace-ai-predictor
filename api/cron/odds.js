/**
 * オッズ取得（A3）の Vercel Cron（tasks.md T4b-04-2、plan.md §3.6・§4.1）。
 *
 * 予定表（scrape_slots）の `odds` スロット（発走の60/30/15/10/5/0分前を期限に、許容幅3分。失敗・一部のみは
 * 60秒おきに再試行）を、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。取得・解析・書き込みは、
 * 既存の scripts/daily/scrape-odds.js（runForRaces）を再利用する（GitHub Actions・CLIと解析・行の組み立てを共有）。
 * 1スロット＝1レース×1窓。単勝・3連単・3連複・2連単/2連複・拡連複の5ページを並列に取り、全券種の全通りを
 * race_odds の1行に保存する（ADR-0057 FR-4）。行は (race_id, window_min) の一意索引で upsert し、
 * source='vercel'・window_min つきで書く（GitHub Actions側の行は source='gha'・window_min=NULL のまま）。
 *
 * モード（scrape_job_state.mode の job='odds'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得せず、データにも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。race_odds へは書かず、予定表に result_digest（構造のダイジェスト）を記録する
 *   live                race_odds へ書き込む（GitHub Actions側のオッズ取得と並走してよい。source で区別する）
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `* 22-23,0-14 * * *`  毎分、JST 07:00〜23:59
 * 最終レースの発走は 22:41〜22:45 JST で、その0分窓の期限+許容幅（+3分）は 22:48 までのため、23:59 までで足りる。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。応答は、処理の完了後に 200/500（waitUntil は使わない）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の odds.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:scrape-odds-job が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createOddsSlotHandler } from "../../scripts/lib/scrapeJobs/oddsHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "odds",
  handleSlot: createOddsSlotHandler(),
});
