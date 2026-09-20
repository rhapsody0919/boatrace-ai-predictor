/**
 * 結果のcatch-up の Vercel Cron（tasks.md T4b-05-2、plan.md §4.1）。
 *
 * 当日 expired になった結果のスロット（許容幅の+90分を過ぎても完了しなかったもの。決まり手が未公開のまま
 * 見捨てられた、取得の失敗が続いた等）を、再取得して補填する（完了の定義Aを守るための後追い。
 * Bの計測は、expired の記録が予定表に残る）。あわせて、次の2つを日次で行う。
 *   - 発走+90分を超えて結果の無いレースの、中止・順延の確定の取りこぼしの補填（毎分の onTick が漏らした分）
 *   - 直近10日の的中フラグの欠落の補完（従来は結果取得のたびに行っていた重いスキャンを、日次に1回へ。T4b-02-1）
 * 詳細は scripts/lib/scrapeJobs/resultHandlers.js の createResultCatchupRun。
 *
 * モード（scrape_job_state.mode の job='result_catchup'）: off なら何もしない。shadow は再取得の取得・解析のみ
 * （書き込まない。確定・的中フラグの補完も行わない）。live は書き込む。
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `50 14 * * *`  23:50 JST
 *   `30 15 * * *`  翌 00:30 JST（補足。最終レースの結果の期限が翌 00:15 のため、23:50 の時点で結果のスロットが
 *                  未完了だった場合、23:50 の実行は対象日を処理済みにせず、この実行が同じ対象日をもう一度処理する。
 *                  対象日は、指定時刻 23:50 から解決するため、00:30 でも前日のまま）
 *
 * maxDuration は、レジストリ（result_catchup.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createResultCatchupRun } from "../../scripts/lib/scrapeJobs/resultHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "result_catchup",
  run: createResultCatchupRun(),
});
