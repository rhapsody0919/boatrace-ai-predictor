/**
 * 締切時オッズ（公式）の取り直し（BOA-496）の Vercel Cron。
 *
 * 予定表（scrape_slots）の `odds_final` スロット（締切の5分後が期限、許容幅55分。締切時オッズの表示に変わるまで
 * 300秒おきに再試行）を、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で消化する。1スロット＝1レースの
 * 5ページ（単勝・複勝／3連単／3連複／2連単・2連複／拡連複）を取り、race_odds_final へ保存する
 * （scripts/lib/scrapeJobs/finalOddsHandlers.js）。
 *
 * モード（scrape_job_state.mode の job='odds_final'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何も取得しない（行が無ければ off の行を作るのみ）
 *   shadow              取得・解析のみ。race_odds_final へは書かず、予定表に result_digest を記録する
 *   live                race_odds_final へ書き込む
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `*\/5 22-23,0-14 * * *`  5分ごと、JST 07:00〜23:55
 * 最終レースの締切は 22:41〜22:45 JST で、その許容幅の終わり（締切60分後）は 23:45 までのため、23:55 までで足りる。
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の odds_final.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:final-odds-job が一致を検査する。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createFinalOddsSlotHandler } from "../../scripts/lib/scrapeJobs/finalOddsHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "odds_final",
  handleSlot: createFinalOddsSlotHandler(),
});
