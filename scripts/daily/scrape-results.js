// Race Results Scraper
// Supabaseからレース一覧を取得し、結果をスクレイピングしてSupabaseに書き込む

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import {
  getTodayDateJST,
  getDateDaysAgo,
  parseDateArg,
} from "../lib/dateUtils.js";
import {
  getRaceSchedule,
  getRacesAfterStart,
  getRacesPastResultWindow,
} from "../lib/raceSchedule.js";
// 結果ページの取得・解析・行の組み立ては raceResultPage.js に置く（呼び出し元はこれまでどおりここから import できる）
import {
  ResultHttpError,
  buildRaceResultRow,
  fetchRaceResultHtml,
  isResultComplete,
  parseRaceResultHtml,
  scrapeRaceResult,
} from "../lib/raceResultPage.js";
// 結果の書き込みとレース単位の入口は raceResultPersist.js に置く
import { persistRaceResults } from "../lib/raceResultPersist.js";
import { runForRaces } from "../lib/raceResultRun.js";
import {
  KFILE_SYNC_LOOKBACK_DAYS,
  syncKFileForDate,
} from "../lib/kfileSync.js";
import { confirmCancellationsForRaceIds } from "../lib/raceCancellation.js";
import { fixMissingHitFlags } from "../lib/predictionHitFix.js";

export {
  runForRaces,
  ResultHttpError,
  buildRaceResultRow,
  fetchRaceResultHtml,
  isResultComplete,
  parseRaceResultHtml,
};

// Generate race result page URL

// Scrape race result（GitHub Actions・CLIの従来の入口。失敗は null に丸める）

/**
 * オーケストレーターから呼び出し可能な結果取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{skipResults?: boolean, skipKFile?: boolean}} [options]
 *   Vercel Cron へ移した処理を止めるためのスイッチ（既定はどちらも false ＝従来どおり全て実行。
 *   scrape-scheduled.js が、リポジトリ変数 SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA から渡す。T4b-02-4・T4b-05-3）
 *   skipResults: 結果取得と、中止・順延の確定を行わない
 *   skipKFile:   Kファイル同期（進入コース・rank4〜6）を行わない
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(
  schedule,
  date,
  { skipResults = false, skipKFile = false } = {},
) {
  let resultSummary = { updated: false, count: 0 };

  if (!skipResults) {
    const startedRaces = getRacesAfterStart(schedule, 5);

    if (startedRaces.length === 0) {
      console.log("📭 結果: 発走後5分以上経過したレースなし");
    } else {
      console.log(`🎯 結果取得: ${startedRaces.length}レース（発走後5分以上）`);

      // schedule から直接 races 情報を構築（追加 DB 呼び出し不要）
      const races = startedRaces.map((r) => ({
        race_id: r.race_id,
        venue_code: r.venue_code,
        race_number: r.race_no,
        start_time: r.start_time,
      }));

      resultSummary = await scrapeAndSaveResults(races, date);
    }

    // 発走90分超・結果未取得のレースを中止・順延「確定」として扱う（BOA-254 FR2、ADR 0040）。
    // startedRaces（5〜90分後ウィンドウ）が0件の日でも、90分を超えて見捨てられた
    // レースは別途存在しうるため、上のearly returnとは独立して必ず実行する
    await confirmOverdueCancellations(schedule);
  } else {
    console.log("⏭️ 結果取得: Vercel Cron へ移行済みのためスキップ");
  }

  if (!skipKFile) {
    // 進入コース（Kファイル方式、BOA-257）とrank4/5/6（BOA-338、Kファイル方式）を、過去数日分について同期。
    // Kファイルは開催日当日の夜〜翌日に公開されるため「当日」は対象にせず、
    // 直近数日分を毎回チェックすることで取得漏れ・公開遅延を自己修復する。
    // scrapeAndSaveResults()のfinishedRaceIds判定はpayout_win等のみを見て
    // 「完了」を判定するためrank4の有無をチェックせず、一度完了判定された
    // レースは再スクレイピングされない（BOA-340）ため、Kファイル方式で独立して自己修復する。
    // 同じ日のKファイルを、2つの同期で別々にダウンロードしていた重複（D4）は、1回に統合した
    await syncRecentKFile();
  } else {
    console.log("⏭️ Kファイル同期: Vercel Cron へ移行済みのためスキップ");
  }

  return resultSummary;
}

/**
 * 直近数日分（当日を除く）について、Kファイル同期を行う。GitHub Actions・CLIの入口。
 * Vercel Cron の kfile-sync は、対象日ごとの結果を集計するため syncKFileForDate を直接呼ぶ。
 */
async function syncRecentKFile() {
  for (let i = 1; i <= KFILE_SYNC_LOOKBACK_DAYS; i++) {
    await syncKFileForDate(getDateDaysAgo(i));
  }
}

/**
 * 発走90分超で結果が取得できていないレースを中止・順延「確定」として扱う（BOA-254 FR2）。
 * getRacesAfterStart(schedule, 5) が対象とする5〜90分後ウィンドウを抜けた
 * レースが対象。既存の結果取得ロジック（scrapeAndSaveResults）は変更しない。
 * GitHub Actions・CLIの入口。失敗しても、結果取得の後続を止めない（ログのみ）。
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 */
async function confirmOverdueCancellations(schedule) {
  const overdueRaces = getRacesPastResultWindow(schedule, 90);
  if (overdueRaces.length === 0) return;
  try {
    await confirmCancellationsForRaceIds(
      supabase,
      overdueRaces.map((r) => r.race_id),
    );
  } catch (error) {
    console.error(`❌ ${error.message}`);
  }
}

/**
 * 結果スクレイピング・DB書き込みの共通処理（GitHub Actions・CLI）
 * @param {Array} races - { race_id, venue_code, race_number, start_time? }[] の配列
 *   start_time（発走予定時刻）は、結果ページの気象の観測時刻に使う。無ければ観測時刻はNULL
 * @param {string} targetDate - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function scrapeAndSaveResults(races, targetDate) {
  // 既に結果があるレースを取得
  const { data: existingResults } = await supabase
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .gte("race_id", targetDate)
    .lt("race_id", `${targetDate}~`);

  // 配当データに加え決まり手（winning_technique）も揃っているレースのみ「完了」扱いにする
  // （isResultComplete の説明を参照。BOA-323）
  const finishedRaceIds = new Set(
    (existingResults || []).filter(isResultComplete).map((r) => r.race_id),
  );

  console.log(
    `Fetching results for ${races.length} races (${finishedRaceIds.size} already finished)\n`,
  );

  let updatedCount = 0;
  let alreadyFinishedCount = 0;
  let notYetCount = 0;
  const newResults = [];
  const scrapeCache = new Map(); // race_id → scraped result (for start timings)
  const startTimeByRaceId = new Map(
    races.filter((r) => r.start_time).map((r) => [r.race_id, r.start_time]),
  );

  // Fetch results for each race
  for (const race of races) {
    const venueName = VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`;
    const raceInfo = `${venueName} R${race.race_number}`;
    process.stdout.write(`${raceInfo.padEnd(20)} `);

    // Skip if already finished with payout data
    if (finishedRaceIds.has(race.race_id)) {
      console.log(`Already finished`);
      alreadyFinishedCount++;
      continue;
    }

    // Scrape result
    const result = await scrapeRaceResult(
      race.venue_code,
      race.race_number,
      targetDate,
    );

    if (result) {
      console.log(
        `New result: ${result.rank1}-${result.rank2}-${result.rank3}`,
      );
      scrapeCache.set(race.race_id, result);
      newResults.push(buildRaceResultRow(race.race_id, result));
      updatedCount++;
    } else {
      console.log(`Not yet finished`);
      notYetCount++;
    }

    // Wait to avoid server overload
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\nResults summary:`);
  console.log(`  - Newly fetched: ${updatedCount} races`);
  console.log(`  - Already finished: ${alreadyFinishedCount} races`);
  console.log(`  - Not yet finished: ${notYetCount} races`);

  // Supabaseに書き込み
  if (newResults.length > 0) {
    await persistRaceResults({
      client: supabase,
      newResults,
      scrapeCache,
      startTimeByRaceId,
    });
  } else {
    console.log("\n📤 結果: 新規データなし");
  }

  // 欠落した的中フラグを修正（新結果の有無に関わらず毎回実行）
  // 直近10日分を対象にすることで、当日限定では拾えない過去日の
  // 一時的な書き込み失敗を後続の実行で自己修復できるようにする。
  // newResults.length > 0の時だけに限定すると、対象日の結果が既に
  // 全件scrape済みになった時点で「新規データなし」が続き、二度と
  // このチェックが走らなくなる（2026-09-06、当日分の的中フラグが
  // 132件全件NULLのまま固着していた実例で発覚）
  // 結果は保存済みのため、補完の失敗で結果取得そのものを失敗扱いにしない（補完は次の実行・日次の
  // result-catchup がやり直す。BOA-391 で fixMissingHitFlags の取得失敗が例外になったため）
  try {
    await fixMissingHitFlags(getDateDaysAgo(9), targetDate);
  } catch (error) {
    console.error(
      `⚠️ 的中フラグの補完に失敗（次の実行で再試行）: ${error.message}`,
    );
  }

  return { updated: newResults.length > 0, count: newResults.length };
}

// Main function（スタンドアローン実行用の後方互換ラッパー）
async function scrapeResults(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Starting race result scraping: ${targetDate}`);

  // 握りつぶし可（BOA-391）: 失敗したら下の「races テーブルから全件」のフォールバックに進む設計のため、空配列で受ける
  const schedule = await getRaceSchedule(targetDate, { throwOnError: false });
  let races;
  if (schedule.length > 0) {
    const startedRaces = getRacesAfterStart(schedule, 5);
    if (startedRaces.length === 0) {
      console.log("📭 発走後5分以上経過したレースなし");
      return;
    }
    console.log(`🎯 取得対象: ${startedRaces.length}レース（発走後5分以上）`);
    races = startedRaces.map((r) => ({
      race_id: r.race_id,
      venue_code: r.venue_code,
      race_number: r.race_no,
    }));
  } else {
    // スケジュール取得失敗時: races テーブルから全件取得（フォールバック）
    console.warn("⚠️ スケジュール取得失敗: races テーブルから全レースを対象");
    const { data: allRaces, error: racesError } = await supabase
      .from("races")
      .select("race_id, venue_code, race_number")
      .eq("race_date", targetDate)
      .order("race_id");
    if (racesError) {
      console.error("❌ レース取得エラー:", racesError.message);
      process.exit(1);
    }
    races = allRaces || [];
    if (races.length === 0) {
      console.log("⚠️ 対象レースがありません");
      return;
    }
  }

  await scrapeAndSaveResults(races, targetDate);
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const targetDate = parseDateArg();
  scrapeResults(targetDate);
}

export {
  KFILE_SYNC_LOOKBACK_DAYS,
  syncActualCourseFromKFile,
  syncRank456FromKFile,
  syncOfficialFinishCodeFromKFile,
  syncKFileForDate,
} from "../lib/kfileSync.js";

export {
  confirmCancellationsForRaceIds,
  clearCancellationsWithResults,
  clearCancellationsWithResultsInRange,
} from "../lib/raceCancellation.js";

export { fixMissingHitFlags } from "../lib/predictionHitFix.js";
