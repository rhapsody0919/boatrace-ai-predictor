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
  formatDateForUrl,
  parseDateArg,
} from "../lib/dateUtils.js";
import { calculateHits, isTurnHit } from "../lib/hitCalculator.js";
import { isCancellationConfirmed } from "../lib/cancellationStatus.js";
import {
  getRaceSchedule,
  getRacesAfterStart,
  getRacesPastResultWindow,
} from "../lib/raceSchedule.js";
import {
  fetchKFileText,
  parseKFileText,
  parseKFileRankings,
} from "../lib/kfileParser.js";
import {
  filterUnchangedRows,
  formatSkipSummary,
  upsertChangedRows,
} from "../lib/unchangedRows.js";
import { buildResultWeatherRows } from "../lib/beforeinfoWeather.js";
import { parseRaceResultPage } from "../lib/raceResultParser.js";
import {
  buildPayoutRows,
  buildResultExtras,
  buildTimingRows,
  toLegacyResult,
} from "../lib/raceResultRows.js";
import { detectResultSchema } from "../lib/raceResultSchema.js";
import { upsertRaceConditions } from "../lib/raceConditionsWriter.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";
import { computeResultDigest } from "../lib/scrapeJobs/resultDigest.js";
import { raceStartInstant } from "../lib/scrapeJobs/time.js";

// Generate race result page URL
function getRaceResultUrl(venueCode, raceNo, dateStr) {
  const ymd = formatDateForUrl(dateStr);
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

const RESULT_FETCH_HEADERS = {
  "User-Agent":
    "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/** 結果ページの取得が、HTTPステータスのエラー（200以外）で失敗した */
export class ResultHttpError extends Error {
  constructor(url, status) {
    super(`結果ページの取得に失敗しました: HTTP ${status} (${url})`);
    this.name = "ResultHttpError";
    this.status = status;
  }
}

/**
 * 結果ページのHTMLを取得する。200以外は ResultHttpError を投げる。
 * fetchImpl を差し替えると、Vercel Cron からは politeFetch（タイムアウト・バックオフ・ブレーカー）を通せる
 * （既定はグローバルの fetch。GitHub Actions・CLI の従来の動作）。
 *
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function fetchRaceResultHtml(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: RESULT_FETCH_HEADERS });
  if (!response.ok) throw new ResultHttpError(url, response.status);
  return response.text();
}

/**
 * 結果ページのHTMLを解析する（純粋関数）。着順・払戻が取れない（未公開・構造の違い）場合は null。
 * 解析は scripts/lib/raceResultParser.js（全項目）で行い、ここでは旧形式（rank1〜6・払戻・進入・ST）に
 * 変換して返す。旧形式に無い項目（着欄の生表記・返還・払戻明細・進入の実順等）は、戻り値の full にある。
 * 解析中の例外は、握りつぶさずに投げる（呼び出し側が「未公開」と「解析の失敗」を区別できるように）。
 */
export function parseRaceResultHtml(html) {
  const full = parseRaceResultPage(html);
  for (const anomaly of full.anomalies) {
    console.warn(`  ⚠️ 結果ページの想定外の表記: ${anomaly}`);
  }
  return toLegacyResult(full, { log: (message) => console.log(message) });
}

// Scrape race result（GitHub Actions・CLIの従来の入口。失敗は null に丸める）
async function scrapeRaceResult(venueCode, raceNo, dateStr) {
  const url = getRaceResultUrl(venueCode, raceNo, dateStr);

  try {
    let html;
    try {
      html = await fetchRaceResultHtml(url);
    } catch (error) {
      if (error instanceof ResultHttpError) {
        console.log(`  [HTTP ${error.status}]`);
        return null;
      }
      throw error;
    }
    return parseRaceResultHtml(html);
  } catch (error) {
    console.error(`  Scraping error: ${error.message}`);
    return null;
  }
}

/**
 * 解析結果から race_results に書く行を組み立てる（純粋関数。scrapeAndSaveResults と runForRaces で共有）。
 *
 * @param {string} raceId
 * @param {NonNullable<ReturnType<typeof parseRaceResultHtml>>} result
 * @param {{resultAt?: string}} [options] result_at（取得時刻）。既定は現在時刻
 */
export function buildRaceResultRow(
  raceId,
  result,
  { resultAt = new Date().toISOString() } = {},
) {
  const payouts = result.payouts || {};
  // combo単位で{amount, popularity}を格納しているscrapePayouts()の構造から
  // 実際の着順に対応するコンボを引き当てる
  const sortedPairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");
  const winEntry = payouts.win ? Object.values(payouts.win)[0] : null;
  const placeEntries = payouts.place ? Object.entries(payouts.place) : [];
  const place1Entry = placeEntries.find(
    ([k]) => k === String(result.rank1),
  )?.[1];
  const place2Entry = placeEntries.find(
    ([k]) => k === String(result.rank2),
  )?.[1];
  const trioEntry = payouts.trio ? Object.values(payouts.trio)[0] : null;
  const trifectaEntry = payouts.trifecta
    ? Object.values(payouts.trifecta)[0]
    : null;
  const exactaEntry = payouts.exacta?.[`${result.rank1}-${result.rank2}`];
  const quinellaEntry =
    payouts.quinella?.[sortedPairKey(result.rank1, result.rank2)];
  const wide1Entry = payouts.wide?.[sortedPairKey(result.rank1, result.rank2)];
  const wide2Entry = payouts.wide?.[sortedPairKey(result.rank1, result.rank3)];
  const wide3Entry = payouts.wide?.[sortedPairKey(result.rank2, result.rank3)];

  return {
    race_id: raceId,
    rank1: result.rank1,
    rank2: result.rank2,
    rank3: result.rank3,
    rank4: result.rank4,
    rank5: result.rank5,
    rank6: result.rank6,
    race_time_1: result.raceTime1,
    race_time_2: result.raceTime2,
    race_time_3: result.raceTime3,
    race_time_4: result.raceTime4,
    race_time_5: result.raceTime5,
    race_time_6: result.raceTime6,
    payout_win: winEntry?.amount ?? null,
    payout_place_1: place1Entry?.amount ?? null,
    payout_place_2: place2Entry?.amount ?? null,
    payout_trifecta: trifectaEntry?.amount ?? null,
    payout_trio: trioEntry?.amount ?? null,
    payout_exacta: exactaEntry?.amount ?? null,
    payout_quinella: quinellaEntry?.amount ?? null,
    payout_wide_1: wide1Entry?.amount ?? null,
    payout_wide_2: wide2Entry?.amount ?? null,
    payout_wide_3: wide3Entry?.amount ?? null,
    popularity_trifecta: trifectaEntry?.popularity ?? null,
    popularity_trio: trioEntry?.popularity ?? null,
    popularity_exacta: exactaEntry?.popularity ?? null,
    popularity_quinella: quinellaEntry?.popularity ?? null,
    popularity_wide_1: wide1Entry?.popularity ?? null,
    popularity_wide_2: wide2Entry?.popularity ?? null,
    popularity_wide_3: wide3Entry?.popularity ?? null,
    winning_technique: result.winningTechnique,
    course_1: result.courseInfo?.course_1 || null,
    course_2: result.courseInfo?.course_2 || null,
    course_3: result.courseInfo?.course_3 || null,
    course_4: result.courseInfo?.course_4 || null,
    course_5: result.courseInfo?.course_5 || null,
    course_6: result.courseInfo?.course_6 || null,
    result_at: resultAt,
  };
}

/**
 * 結果が「完了」か。配当データに加え決まり手（winning_technique）も揃っていること。
 * 決まり手・進入コース・スタートタイミング（race_start_timings）は公式サイト側で
 * 着順・払戻金より掲載が遅く（発走20〜30分後以降）、payout_winだけで判定すると
 * 3連単払戻からの着順復元フォールバック（PR#612）で早期に確定してしまい、以降
 * 再取得されないまま決まり手・STが永久にnullで残ってしまう（BOA-323）
 */
export function isResultComplete(row) {
  return (
    row !== null &&
    row !== undefined &&
    row.payout_win !== null &&
    row.payout_win !== undefined &&
    row.winning_technique !== null &&
    row.winning_technique !== undefined
  );
}

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
 * 進入コース・rank4〜6のKファイル同期の対象日数（当日を除く直近N日）。
 * 大きくし過ぎるとKファイル未取得日も毎回ダウンロードを試みてしまうため、
 * 通常運用での取得漏れを拾える程度の小さい値にとどめる。
 */
export const KFILE_SYNC_LOOKBACK_DAYS = 4;

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
 * 実進入コース同期で書き込む列（race_id は更新条件）。Kファイルのパース結果には
 * venue_code・race_numberも含まれるが race_results の列ではないため、比較・更新には含めない
 */
const ACTUAL_COURSE_COLUMNS = [1, 2, 3, 4, 5, 6].map(
  (n) => `actual_course_${n}`,
);

/**
 * 指定日について、公式成績ファイル（Kファイル）から実進入コースを取得し
 * race_results.actual_course_1〜6にマージする（BOA-257）。
 *
 * BOA-349（原因）: 「未取得レースがあるか」の判定が actual_course_1 のnull判定だったため、
 * 1号艇が欠場したレース（Kファイルの結果行が「K0」「K1」等の欠場行で、1号艇は進入コースを
 * 持たない＝actual_course_1がnullなのが正しい状態。2026-09-15 平和島3R・2026-09-16 唐津12R等）が
 * 永久に「未取得」と判定され続け、その日の全レースを毎回UPDATEしていた
 * （累計167,072回・WAL 1.3GB）。しかも race_results のUPDATEは trg_update_predictions で
 * predictions・bet_recommendations の再UPDATEも連鎖させる。パーサーの不具合ではない
 * （生のKファイルで欠場行を確認済み、verify-unchanged-rows.js で固定）。
 * 対策:
 *   (a) 既存値と同じレースはUPDATEを発行しない（変更のある行だけ書く）
 *   (b) 「未取得」の判定を「actual_course_1〜6が全てnull」に改める。欠場艇はその艇のcolumnだけが
 *       nullで、他の艇のcolumnは埋まるため、欠場を含む同期済みレースを未取得と誤判定しない
 *       （2026-09-01〜18の2,506レースで、actual_course_1がnullのレース3件は全て
 *       他の艇のcolumnが埋まっており、全columnがnullのレースは0件）
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] trueならDBへ書き込まず、書くはずの件数だけ数える
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {() => Promise<string|null>} [options.loadText] Kファイルのテキストの取得（既定は、その日のKファイルをダウンロードする。
 *   進入コースとrank4〜6の同期で、同じ日のKファイルを1回だけダウンロードするために、呼び出し側が共有する）
 * @returns {Promise<{updated: number, skipped: number, status: string, parsed: number, error?: string}>}
 *   updated=書き込んだ件数（dry-runでは書くはずの件数）。status:
 *   nothing_pending（同期済み・対象なし。ダウンロードしない）/ pending_check_failed / kfile_error（ダウンロード失敗。
 *   error に理由）/ kfile_unavailable（未公開・開催なし）/ no_races_parsed / synced
 */
export async function syncActualCourseFromKFile(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    loadText = () => fetchKFileText(dateStr),
  } = {},
) {
  // 結果確定済み（rank1あり）だが進入コースが1艇分も未取得（actual_course_1〜6が全てnull）の
  // レースが無ければ、Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）。
  // 1艇でも埋まっていれば同期済み（欠場艇のcolumnだけがnullのレースを含む。上のBOA-349参照）
  const { data: pending, error: pendingError } =
    await ACTUAL_COURSE_COLUMNS.reduce(
      (query, column) => query.is(column, null),
      client
        .from("race_results")
        .select("race_id")
        .gte("race_id", dateStr)
        .lt("race_id", `${dateStr}~`)
        .not("rank1", "is", null),
    ).limit(1);

  if (pendingError) {
    // actual_course_1列がまだ存在しない場合（マイグレーション未適用）もここに来る。
    // 日次パイプライン全体を止めないよう、ログのみでスキップする
    console.error(
      `  ⚠️ actual_course対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return {
      updated: 0,
      skipped: 0,
      parsed: 0,
      status: "pending_check_failed",
      error: pendingError.message,
    };
  }
  if (!pending || pending.length === 0) {
    // 同期済み、または対象レース無し
    return { updated: 0, skipped: 0, parsed: 0, status: "nothing_pending" };
  }

  let text;
  try {
    text = await loadText();
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return {
      updated: 0,
      skipped: 0,
      parsed: 0,
      status: "kfile_error",
      error: e.message,
    };
  }
  if (!text) {
    console.log(`  進入コース: Kファイル未公開/開催なし (${dateStr})`);
    return { updated: 0, skipped: 0, parsed: 0, status: "kfile_unavailable" };
  }

  const parsed = parseKFileText(text, dateStr);
  if (parsed.length === 0) {
    console.log(`  進入コース: Kファイルからレースを抽出できず (${dateStr})`);
    return { updated: 0, skipped: 0, parsed: 0, status: "no_races_parsed" };
  }

  const rows = parsed.map((row) => ({
    race_id: row.race_id,
    ...Object.fromEntries(ACTUAL_COURSE_COLUMNS.map((c) => [c, row[c]])),
  }));
  // race_resultsに行が無いレースはUPDATEしても0件のため書かない（writeMissing: false）。
  // 既存値と同じ行（=何もUPDATEで変わらない行）もUPDATEしない
  const { toWrite, stats, fallback } = await filterUnchangedRows(
    client,
    "race_results",
    rows,
    { keyColumns: ["race_id"], writeMissing: false },
  );

  let updated = 0;
  if (dryRun) {
    updated = toWrite.length;
  } else {
    for (const row of toWrite) {
      const { race_id: raceId, ...columns } = row;
      const { error: updateError } = await client
        .from("race_results")
        .update(columns)
        .eq("race_id", raceId);
      if (updateError) {
        console.error(
          `  ⚠️ actual_course更新エラー(${raceId}): ${updateError.message}`,
        );
      } else {
        updated++;
      }
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary(`進入コース(Kファイル方式, ${dateStr})`, stats, { fallback })}` +
      ` / 更新${updated}件（Kファイル${rows.length}件中、race_results未登録${stats.missing}件）`,
  );
  return {
    updated,
    skipped: stats.unchanged,
    parsed: parsed.length,
    status: "synced",
  };
}

/**
 * 指定日について、公式成績ファイル（Kファイル）からrank4/5/6を取得し
 * race_results.rank4〜6にマージする（BOA-340）。
 *
 * 安全策（BOA-338のバックフィルスクリプトと同じ）: Kファイルからパースした
 * 1〜3着が既存のrank1〜3と完全一致する場合のみ更新する。不一致・重複艇番
 * （パース異常の疑い）・Kファイル側に該当レースが無い場合は更新せずスキップする。
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} [options] syncActualCourseFromKFile と同じ（dryRun・client・loadText）
 * @returns {Promise<{updated: number, status: string, parsed: number, pending: number, skipped?: number, error?: string}>}
 *   status は syncActualCourseFromKFile と同じ語彙
 */
export async function syncRank456FromKFile(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    loadText = () => fetchKFileText(dateStr),
  } = {},
) {
  // rank1はある（結果確定済み）がrank4が未取得のレースが無ければ
  // Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）
  const { data: pending, error: pendingError } = await client
    .from("race_results")
    .select("race_id, rank1, rank2, rank3")
    .gte("race_id", dateStr)
    .lt("race_id", `${dateStr}~`)
    .not("rank1", "is", null)
    .is("rank4", null);

  if (pendingError) {
    console.error(
      `  ⚠️ rank456対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return {
      updated: 0,
      parsed: 0,
      pending: 0,
      status: "pending_check_failed",
      error: pendingError.message,
    };
  }
  if (!pending || pending.length === 0) {
    // 同期済み、または対象レース無し
    return { updated: 0, parsed: 0, pending: 0, status: "nothing_pending" };
  }

  let text;
  try {
    text = await loadText();
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "kfile_error",
      error: e.message,
    };
  }
  if (!text) {
    console.log(`  rank456: Kファイル未公開/開催なし (${dateStr})`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "kfile_unavailable",
    };
  }

  const rows = parseKFileRankings(text, dateStr);
  if (rows.length === 0) {
    console.log(`  rank456: Kファイルからレースを抽出できず (${dateStr})`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "no_races_parsed",
    };
  }
  const kfileByRaceId = new Map(rows.map((r) => [r.race_id, r]));

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const race of pending) {
    const k = kfileByRaceId.get(race.race_id);
    if (
      !k ||
      !k.valid ||
      k.rank1 !== race.rank1 ||
      k.rank2 !== race.rank2 ||
      k.rank3 !== race.rank3
    ) {
      skipped++;
      // BOA-338のbackfill-rank456-from-kfile.jsのmismatchDetailsと同様、
      // race_id・理由・両側の値を残す。集計件数だけでは恒常的な不一致
      // レースがあっても気づけないため（毎日スキップされ続けるだけになる）
      const reason = !k
        ? "not_in_kfile"
        : !k.valid
          ? "duplicate_boat_in_kfile"
          : "rank1_3_mismatch";
      console.log(
        `  ⚠️ rank456スキップ(${race.race_id}): ${reason}` +
          (k
            ? ` db=[${race.rank1},${race.rank2},${race.rank3}] kfile=[${k.rank1},${k.rank2},${k.rank3}]`
            : ""),
      );
      continue;
    }

    // Kファイルにも4〜6着が無いレース（3着以内しか完走していない等）は、pendingの条件
    // （rank4がnull）を永久に満たし続けるため、null→nullの空UPDATEを毎回発行してしまう
    // （BOA-349と同種）。既存値（null）と同じなら書かない
    if (k.rank4 == null && k.rank5 == null && k.rank6 == null) {
      unchanged++;
      continue;
    }

    if (dryRun) {
      updated++;
      continue;
    }
    const { error: updateError } = await client
      .from("race_results")
      .update({ rank4: k.rank4, rank5: k.rank5, rank6: k.rank6 })
      .eq("race_id", race.race_id);
    if (updateError) {
      console.error(
        `  ⚠️ rank456更新エラー(${race.race_id}): ${updateError.message}`,
      );
    } else {
      updated++;
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}rank456(Kファイル方式): ${updated}/${pending.length}件更新 (${dateStr}, スキップ${skipped}件, 変更なし${unchanged}件スキップ)`,
  );
  return {
    updated,
    skipped,
    parsed: rows.length,
    pending: pending.length,
    status: "synced",
  };
}

/**
 * 指定日のKファイル同期（進入コース＋rank4〜6）。同じ日のKファイルを、1回だけダウンロードして両方に使う
 * （D4の解消。従来は、2つの同期が同じ日を別々にダウンロードしていた）。どちらも、未同期のレースが無ければ
 * ダウンロードしない。Vercel Cron の kfile-sync と、GitHub Actions・CLIの両方から呼ぶ。
 *
 * @param {string} dateStr YYYY-MM-DD
 * @param {Object} [options]
 * @param {boolean} [options.dryRun]
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {typeof fetch} [options.fetchImpl] Kファイルのダウンロードに使う fetch（Vercelでは politeFetch）
 * @param {(dateStr: string, options: {fetchImpl?: typeof fetch}) => Promise<string|null>} [options.fetchText] テスト用の差し替え
 * @returns {Promise<{date: string, downloads: number, actualCourse: Awaited<ReturnType<typeof syncActualCourseFromKFile>>, rank456: Awaited<ReturnType<typeof syncRank456FromKFile>>}>}
 */
export async function syncKFileForDate(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    fetchImpl,
    fetchText = fetchKFileText,
  } = {},
) {
  let downloads = 0;
  /** @type {Promise<string|null>|null} */
  let cached = null;
  const loadText = () => {
    if (!cached) {
      downloads++;
      cached = fetchText(dateStr, { fetchImpl });
    }
    return cached;
  };
  const actualCourse = await syncActualCourseFromKFile(dateStr, {
    dryRun,
    client,
    loadText,
  });
  const rank456 = await syncRank456FromKFile(dateStr, {
    dryRun,
    client,
    loadText,
  });
  return { date: dateStr, downloads, actualCourse, rank456 };
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
 * 指定のレースのうち、結果（race_results の行）が無く、まだ確定していないものを、中止・順延「確定」にする。
 * 呼び出し側が「発走90分超」を保証して渡す（GitHub Actionsは schedule から、Vercel Cron は発走時刻の範囲の
 * クエリから、result-catchup は当日の全レースから選ぶ）。
 *
 * 読み取りに失敗したら、書き込まずに例外にする（結果の有無が分からないまま「結果なし」とみなして、
 * 結果のあるレースまで中止にしてしまわないため）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} overdueIds
 * @param {{reason?: string}} [options] reason: ログに出す確定の根拠（既定は発走90分超・結果未取得。
 *   公式の告知による確定＝ race_status ジョブは、その旨を渡す）
 * @returns {Promise<{checked: number, confirmed: string[]}>}
 */
export async function confirmCancellationsForRaceIds(
  client,
  overdueIds,
  { reason = "発走90分超・結果未取得" } = {},
) {
  if (overdueIds.length === 0) return { checked: 0, confirmed: [] };

  const [results, races] = await Promise.all([
    client.from("race_results").select("race_id").in("race_id", overdueIds),
    client
      .from("races")
      .select("race_id, cancellation_status")
      .in("race_id", overdueIds),
  ]);
  if (results.error) {
    throw new Error(
      `中止・順延の確定: race_results の取得に失敗しました: ${results.error.message}`,
    );
  }
  if (races.error) {
    throw new Error(
      `中止・順延の確定: races の取得に失敗しました: ${races.error.message}`,
    );
  }

  const hasResult = new Set((results.data || []).map((r) => r.race_id));
  const alreadyConfirmed = new Set(
    (races.data || [])
      .filter((r) => isCancellationConfirmed(r.cancellation_status))
      .map((r) => r.race_id),
  );

  const toConfirm = overdueIds.filter(
    (id) => !hasResult.has(id) && !alreadyConfirmed.has(id),
  );
  if (toConfirm.length === 0) {
    return { checked: overdueIds.length, confirmed: [] };
  }

  const { error } = await client
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in("race_id", toConfirm);
  if (error) {
    throw new Error(
      `races (cancellation_status確定) 一括更新エラー: ${error.message}`,
    );
  }
  console.log(`  ⚠️ 中止・順延を確定: ${toConfirm.length}件（${reason}）`);
  return { checked: overdueIds.length, confirmed: toConfirm };
}
/**
 * predictions の的中判定を更新する（結果が新規・変更のレースだけ）。
 *
 * 変更の無いレース（再取得されただけ）は前回の実行で判定済みで、trg_update_predictions も同じ判定を行うため、
 * 毎回predictionsを再UPDATEしない。判定漏れは fixMissingHitFlags が自己修復する。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Object[]} resultsToJudge race_results の行（rank1〜3・payout_* を持つ）
 */
async function judgeAndUpdateHits(client, resultsToJudge) {
  console.log(`\n📤 predictions の的中判定を更新中...`);
  let winHits = 0;
  let placeHits = 0;
  let trifectaHits = 0;
  let trioHits = 0;

  const newResultIds = resultsToJudge.map((r) => r.race_id);
  const { data: allPredictions } =
    newResultIds.length === 0
      ? { data: [] } // 全レースが変更なしなら、predictionsの読み取りも不要
      : await client
          .from("predictions")
          .select(
            "prediction_id, model_id, top_pick, top_2nd, top_3rd, race_id, feature_contributions",
          )
          .in("race_id", newResultIds);

  // race_id ごとにグループ化
  const predsByRace = new Map();
  for (const pred of allPredictions || []) {
    if (!predsByRace.has(pred.race_id)) predsByRace.set(pred.race_id, []);
    predsByRace.get(pred.race_id).push(pred);
  }

  for (const result of resultsToJudge) {
    const predictions = predsByRace.get(result.race_id) || [];
    if (predictions.length === 0) continue;

    for (const pred of predictions) {
      // 単勝: 1着予測が的中
      const isWinHit = pred.top_pick === result.rank1;

      // 複勝: 1着予測が2着以内（ボートレースのルール）
      const isPlaceHit =
        pred.top_pick === result.rank1 || pred.top_pick === result.rank2;

      // unified（top_3rdを予想しないモデル）には3連複/3連単の的中判定を適用しない
      // （2026-08-14修正、BOA-191）。旧実装はtop_3rd=nullのままfalse判定してしまい、
      // race_history_cacheの動的集計に「unifiedモデルの3連単的中率0%」という
      // 実態と異なる偽エントリが混入していた
      const predictsTrio = pred.top_3rd != null;

      let isTrifectaHit = null;
      let isTrioHit = null;
      if (predictsTrio) {
        const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].sort(
          (a, b) => a - b,
        );
        const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
          (a, b) => a - b,
        );

        // ⚠️ 命名注意: 変数名の英語と日本語が逆転（DB列名に合わせている）
        // isTrifectaHit → 実態: 3連複的中（順不同）
        isTrifectaHit =
          predTop3[0] === resultTop3[0] &&
          predTop3[1] === resultTop3[1] &&
          predTop3[2] === resultTop3[2];

        // isTrioHit → 実態: 3連単的中（順序一致）
        isTrioHit =
          pred.top_pick === result.rank1 &&
          pred.top_2nd === result.rank2 &&
          pred.top_3rd === result.rank3;
      }

      // 複勝の配当を計算（top_pickが何着かによって異なる）
      let payoutPlace = 0;
      if (isPlaceHit) {
        if (pred.top_pick === result.rank1) {
          payoutPlace = result.payout_place_1 || 0;
        } else if (pred.top_pick === result.rank2) {
          payoutPlace = result.payout_place_2 || 0;
        }
      }

      // 展開予測的中（unifiedモデルのみ。feature_contributions.turnPrediction
      // が無い旧モデルはnullのまま＝「対象外」として区別する。ADR 0013）
      // ここではmodel_idを見ておらず、standard/safeBet/upsetFocusにturnPrediction
      // が入っていた期間はそれらにもis_hit_turnを計算・書き込んでいた（下流の
      // update-race-history-cache.jsはmodel_id='unified'限定で読むため実害は無い）。
      // BOA-408（predictions.feature_contributionsの3モデル重複解消）以降、
      // safeBet・upsetFocusのfeature_contributionsはNULLになるため、この2モデルは
      // 自然にhasTurnPrediction=falseへ戻る（ADR 0013の設計意図どおりに近づく）
      const turnPatterns = pred.feature_contributions?.turnPrediction?.patterns;
      const hasTurnPrediction =
        Array.isArray(turnPatterns) && turnPatterns.length > 0;
      const turnHit = hasTurnPrediction
        ? isTurnHit(turnPatterns, result.rank1)
        : null;

      const updateData = {
        is_hit_win: isWinHit,
        is_hit_place: isPlaceHit,
        is_hit_trifecta: isTrifectaHit,
        is_hit_trio: isTrioHit,
        is_hit_turn: turnHit,
        payout_win: isWinHit ? result.payout_win : 0,
        payout_place: payoutPlace,
        payout_trifecta: predictsTrio
          ? isTrifectaHit
            ? result.payout_trifecta
            : 0
          : null,
        payout_trio: predictsTrio ? (isTrioHit ? result.payout_trio : 0) : null,
      };

      const { error: updateError } = await client
        .from("predictions")
        .update(updateData)
        .eq("prediction_id", pred.prediction_id);

      if (!updateError) {
        if (isWinHit) winHits++;
        if (isPlaceHit) placeHits++;
        if (isTrifectaHit) trifectaHits++;
        if (isTrioHit) trioHits++;
      }
    }
  }

  console.log(`  ✅ 単勝的中: ${winHits}件, 複勝的中: ${placeHits}件`);
  console.log(`  ✅ 3連複的中: ${trifectaHits}件, 3連単的中: ${trioHits}件`);
}

/**
 * 取得した結果をDBへ書き込む（race_results・race_start_timings・気象・的中判定）。
 * scrapeAndSaveResults（GitHub Actions・CLI）と runForRaces（Vercel Cron）で共有する。
 *
 * 書き込みの失敗は、従来どおり後続（気象・的中判定）を止めず、errors に集めて返す
 * （GitHub Actions側は従来どおり無視する。Vercel Cron側は、errors があれば、その実行を失敗として再試行する）。
 *
 * @param {Object} params
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {Object[]} params.newResults buildRaceResultRow が作った行
 * @param {Map<string, ReturnType<typeof parseRaceResultHtml>>} params.scrapeCache race_id → 解析結果
 * @param {Map<string, Date>} params.startTimeByRaceId race_id → 発走予定時刻（気象の観測時刻に使う）
 * @returns {Promise<{changedResults: Object[], startTimingRowsWritten: Object[], errors: Error[]}>}
 */
async function persistRaceResults({
  client,
  newResults,
  scrapeCache,
  startTimeByRaceId,
}) {
  const errors = [];
  console.log(`\n📤 Supabaseに結果を書き込み中...`);

  // 決まり手・ST等が公式サイトに出るまで（発走20〜30分後以降）、着順・払戻金だけ揃った
  // レースは「完了」扱いにならず毎回再取得される（BOA-323）。その間の再取得では、
  // 前回と同じ値をupsertし直していた。race_results の書き込みは trg_update_predictions で
  // predictions・bet_recommendations の再UPDATEも連鎖させるため、変更の無い行は書かない。
  // result_at は取得時刻で毎回変わるが情報を持たないため比較から外す
  // （変更なしのレースは最初に取得できた時刻が残る）
  //
  // 結果系の新しい列・テーブル（マイグレーション077〜079。docs/design/race-result-full-fields/plan.md）は、
  // 適用済みのDBにだけ書く。未適用のDBでは、旧実装と同じ列だけを書く（挙動が変わらない）
  const schema = await detectResultSchema(client);
  const resultRows = schema.results
    ? newResults.map((row) => ({
        ...row,
        ...(scrapeCache.has(row.race_id)
          ? buildResultExtras(scrapeCache.get(row.race_id))
          : {}),
      }))
    : newResults;
  const { toWrite: changedResults, error: resultsError } =
    await upsertChangedRows(client, "race_results", resultRows, {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      ignoreColumns: ["result_at"],
      label: "race_results",
    });
  if (resultsError) errors.push(resultsError);

  // race_start_timingsに艇別の結果（ST・着欄・進入・レースタイム）を書き込み。
  // 077が未適用なら、STを読めた艇の行だけ（旧実装と同じ）
  const allStartTimings = [...scrapeCache].flatMap(([raceId, scraped]) =>
    buildTimingRows(raceId, scraped, { extended: schema.timings }),
  );

  let startTimingRowsWritten = [];
  if (allStartTimings.length > 0) {
    // 書く行には updated_at を設定する（WS2。created_at はINSERT時のDBの DEFAULT に任せる）
    const timingsResult = await upsertChangedRows(
      client,
      "race_start_timings",
      allStartTimings,
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        label: "race_start_timings",
        stampUpdatedAt: true,
      },
    );
    startTimingRowsWritten = timingsResult.toWrite;
    if (timingsResult.error) errors.push(timingsResult.error);
  }

  // 払戻明細（同着の複数口・特払・不成立を含む。079が適用済みのときだけ）
  if (schema.payouts) {
    const payoutRows = [...scrapeCache].flatMap(([raceId, scraped]) =>
      buildPayoutRows(raceId, scraped),
    );
    if (payoutRows.length > 0) {
      const payoutsResult = await upsertChangedRows(
        client,
        "race_payouts",
        payoutRows,
        {
          onConflict: "race_id,bet_type,seq",
          keyColumns: ["race_id", "bet_type", "seq"],
          label: "race_payouts",
          stampUpdatedAt: true,
          // 1レース約8〜14行。PostgRESTの1000行上限を超えない範囲に分割する
          chunkSize: 50,
        },
      );
      if (payoutsResult.error) errors.push(payoutsResult.error);
    }
  }

  // レース時点の気象（結果ページの水面気象情報）を race_conditions へ反映する（BOA-358）。
  // 発走前に取得した値（beforeinfo）より新しい確定値のため上書きする。変更のある行だけ書く。
  // 失敗しても、以降の的中判定を止めない
  try {
    const { rows: weatherRows, stats: weatherStats } = buildResultWeatherRows(
      [...scrapeCache].map(([raceId, scraped]) => ({
        raceId,
        startTime: startTimeByRaceId.get(raceId) ?? null,
        conditions: scraped.weather,
      })),
    );
    console.log(
      `🌤️ 結果ページの気象: 取得${weatherStats.fetched}レース / 解析${weatherStats.parsed}レース`,
    );
    if (weatherStats.fetched > 0 && weatherRows.length === 0) {
      console.warn(
        "⚠️ 結果ページの気象: 結果を取得したが、気象が1件も解析できなかった（公式ページの構造変更の可能性）",
      );
    }
    if (weatherRows.length > 0) {
      await upsertRaceConditions(client, weatherRows, {
        label: "race_conditions(結果ページの気象)",
      });
    }
  } catch (weatherError) {
    console.error(
      `❌ 結果ページの気象の更新エラー（結果は保存済み）: ${weatherError.message}`,
    );
  }

  // 的中判定は、race_resultsが新規・変更のレースだけ行う（judgeAndUpdateHits の説明を参照）
  const changedResultIds = new Set(changedResults.map((r) => r.race_id));
  const resultsToJudge = newResults.filter((r) =>
    changedResultIds.has(r.race_id),
  );
  await judgeAndUpdateHits(client, resultsToJudge);

  return { changedResults, startTimingRowsWritten, errors };
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
  await fixMissingHitFlags(getDateDaysAgo(9), targetDate);

  return { updated: newResults.length > 0, count: newResults.length };
}

/**
 * レース単位の入口（Vercel Cron のスロット消化・catch-up から呼ぶ。T4b-02-1）。
 *
 * scrapeAndSaveResults と同じ解析（parseRaceResultHtml）・行の組み立て（buildRaceResultRow）・書き込み
 * （persistRaceResults）を使う。違いは次のとおり:
 *   - 取得は fetchHtml（Vercelでは politeFetch 経由）で行い、待機（500ms）は入れず、concurrency で並列にする
 *   - 「直近10日の的中フラグの補完（fixMissingHitFlags）」は呼ばない（日次の result-catchup へ移した。
 *     ここでは、今回書いた結果の的中判定のみ）
 *   - mode="shadow" は、取得・解析のみで、データテーブルへ一切書かない。既存の完了済みの結果も、取得して
 *     ダイジェストを計算する（既存基盤が書いた値との一致を、ダイジェストで比べるため）
 *   - mode="live" は、既に完了済み（payout_win・winning_technique が揃う）のレースを、取得せずに終える
 *
 * 各レースの outcome（scrape_slots.outcome と同じ語彙）:
 *   ok                完了（決まり手まで揃った）。resultDigest を返す
 *   partial           着順・払戻のみ（決まり手が未公開）。live では書き込み済み。再試行する
 *   no_values         結果ページから着順・払戻を解析できなかった（未公開・中止・順延）。再試行する
 *   skipped_have_data （live のみ）既に完了済み
 *   error             取得（HTTP・ネットワーク）・解析・書き込みの失敗。再試行する
 *   breaker_open      サーキットブレーカーが開いていた。retryAt まで再試行を遅らせる
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number, start_time?: Date}>} races
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD（結果ページの日付）
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<string>} [options.fetchHtml] 既定は fetchRaceResultHtml（グローバルの fetch）
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {() => Date} [options.now]
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, resultDigest?: string, error?: string, retryAt?: Date}>>}
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchHtml = (url) => fetchRaceResultHtml(url),
    client = supabase,
    concurrency = 1,
    now = () => new Date(),
  } = {},
) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  // 1) live: 既に完了済みのレースは、取得しない
  const finished = new Set();
  if (live && races.length > 0) {
    const { data, error } = await client
      .from("race_results")
      .select("race_id, payout_win, winning_technique")
      .in(
        "race_id",
        races.map((r) => r.race_id),
      );
    if (error) {
      throw new Error(`結果の既存行の取得に失敗しました: ${error.message}`);
    }
    for (const r of data ?? []) {
      if (isResultComplete(r)) finished.add(r.race_id);
    }
    for (const race of races) {
      if (finished.has(race.race_id)) {
        outcomes.set(race.race_id, { ...base, outcome: "skipped_have_data" });
      }
    }
  }

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  /** @type {Array<{race: Object, parsed: NonNullable<ReturnType<typeof parseRaceResultHtml>>, row: Object}>} */
  const fetched = [];
  await mapWithConcurrency(
    races.filter((race) => !finished.has(race.race_id)),
    concurrency,
    async (race) => {
      try {
        const html = await fetchHtml(
          getRaceResultUrl(race.venue_code, race.race_number, date),
        );
        const parsed = parseRaceResultHtml(html);
        if (!parsed) {
          outcomes.set(race.race_id, {
            ...base,
            outcome: "no_values",
            error:
              "結果ページから着順・払戻を解析できませんでした（未公開・中止・順延の可能性）",
          });
          return;
        }
        const row = buildRaceResultRow(race.race_id, parsed, {
          resultAt: now().toISOString(),
        });
        fetched.push({ race, parsed, row });
      } catch (error) {
        if (error instanceof BreakerOpenError) {
          outcomes.set(race.race_id, {
            ...base,
            outcome: "breaker_open",
            retryAt: new Date(error.until),
            error: error.message,
          });
        } else {
          outcomes.set(race.race_id, {
            ...base,
            outcome: "error",
            error: error.message,
          });
        }
      }
    },
  );

  // 3) live: 書き込む。shadow: 書かない
  let persisted = null;
  if (live && fetched.length > 0) {
    try {
      const startTimeByRaceId = await loadStartTimes(client, date, fetched);
      persisted = await persistRaceResults({
        client,
        newResults: fetched.map((f) => f.row),
        scrapeCache: new Map(fetched.map((f) => [f.race.race_id, f.parsed])),
        startTimeByRaceId,
      });
    } catch (error) {
      // 書き込み前後の想定外の失敗（DB接続等）。書けたか分からないため、全レースを再試行する（書き込みは冪等）
      for (const { race } of fetched) {
        outcomes.set(race.race_id, {
          ...base,
          rowsParsed: 1,
          outcome: "error",
          error: `結果の書き込みに失敗しました: ${error.message}`,
        });
      }
      persisted = { failed: true };
    }
  }

  const changedIds = new Set(
    (persisted?.changedResults ?? []).map((r) => r.race_id),
  );
  const timingsWrittenByRace = new Map();
  for (const row of persisted?.startTimingRowsWritten ?? []) {
    timingsWrittenByRace.set(
      row.race_id,
      (timingsWrittenByRace.get(row.race_id) ?? 0) + 1,
    );
  }
  for (const { race, parsed, row } of fetched) {
    if (persisted?.failed) continue; // 上で error を設定済み
    if (persisted?.errors?.length > 0) {
      outcomes.set(race.race_id, {
        ...base,
        rowsParsed: 1,
        outcome: "error",
        error: persisted.errors.map((e) => e.message).join(" / "),
      });
      continue;
    }
    // 不成立（全勝式が不成立）のレースは、決まり手が出ない・単勝の払戻が無いため、待っても揃わない。
    // 「決まり手が未公開」として毎分再取得し続けないよう、着順・払戻の表が読めた時点で完了とする
    const complete =
      isResultComplete(row) || parsed.full?.race_status === "no_race";
    outcomes.set(race.race_id, {
      ...base,
      rowsParsed: 1,
      rowsWritten:
        (changedIds.has(race.race_id) ? 1 : 0) +
        (timingsWrittenByRace.get(race.race_id) ?? 0),
      outcome: complete ? "ok" : "partial",
      resultDigest: complete
        ? computeResultDigest(
            row,
            (parsed.startTimings ?? []).map((st) => ({
              race_id: race.race_id,
              ...st,
            })),
          )
        : undefined,
      error: complete
        ? undefined
        : "決まり手が未公開です（着順・払戻のみ取得。再試行します）",
    });
  }

  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(race.race_id),
  }));
}

/**
 * 書き込む結果の発走予定時刻（気象の観測時刻）を、races から1回のクエリで取る。races の行に start_time が
 * 無い（取れない）レースは、観測時刻なし（NULL）で書く（従来の scrapeAndSaveResults と同じ）。
 * 引数の races に start_time（Date）が渡されていれば、それを使う。
 */
async function loadStartTimes(client, date, fetched) {
  const startTimeByRaceId = new Map(
    fetched
      .filter((f) => f.race.start_time)
      .map((f) => [f.race.race_id, f.race.start_time]),
  );
  const missing = fetched
    .map((f) => f.race.race_id)
    .filter((id) => !startTimeByRaceId.has(id));
  if (missing.length === 0) return startTimeByRaceId;
  const { data, error } = await client
    .from("races")
    .select("race_id, start_time")
    .in("race_id", missing);
  if (error) {
    // 観測時刻が付かないだけで、結果そのものの保存には影響しない
    console.warn(
      `⚠️ 発走時刻の取得に失敗（気象の観測時刻はNULL）: ${error.message}`,
    );
    return startTimeByRaceId;
  }
  for (const r of data ?? []) {
    if (!r.start_time) continue;
    try {
      startTimeByRaceId.set(r.race_id, raceStartInstant(date, r.start_time));
    } catch (e) {
      console.warn(`⚠️ 発走時刻を解釈できません(${r.race_id}): ${e.message}`);
    }
  }
  return startTimeByRaceId;
}
// Main function（スタンドアローン実行用の後方互換ラッパー）
async function scrapeResults(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Starting race result scraping: ${targetDate}`);

  const schedule = await getRaceSchedule(targetDate);
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

// Supabaseのデフォルトlimit(1000行)を超えるクエリを.range()でページネーションして全件取得する
async function fetchAllRange(table, select, buildQuery, client = supabase) {
  const results = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(
      client.from(table).select(select),
    ).range(from, from + pageSize - 1);
    if (error) {
      console.error(`  ❌ ${table}取得エラー:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

// 結果があるのにis_hit_winがNULLの予測を修正
// startDate〜endDate（両端含む、race_id昇順比較）の範囲で欠落を検知・修復する。
// 通常呼び出しは直近数日分の範囲を渡し、当日限定では拾えない過去日の
// 一時的な書き込み失敗（2026-09-06発覚）を後続の実行で自己修復できるようにする。
// GitHub Actions では結果取得のたびに、Vercel Cron では日次の result-catchup で呼ぶ（T4b-02-1）。
// 戻り値: 欠落していた件数と修正できた件数（呼び出し側の多くは無視する）
export async function fixMissingHitFlags(
  startDate,
  endDate = startDate,
  { client = supabase } = {},
) {
  // is_hit_winがNULLの予測を取得
  // ⚠️ Supabaseのデフォルトlimit(1000行)を超える可能性があるため.range()でページネーションする
  // （2026-09-06発覚: 日付範囲を広げた際に無ページネーションのままだったため、範囲内の件数が
  // 1000件を超えると挿入順で末尾＝直近日（当日）の結果が切り捨てられ、当日分の欠落が
  // 一切修復されないまま固着していた）
  const missingPredictions = await fetchAllRange(
    "predictions",
    "prediction_id, race_id, top_pick, top_2nd, top_3rd, feature_contributions",
    (q) =>
      q
        .gte("race_id", startDate)
        .lt("race_id", `${endDate}~`)
        .is("is_hit_win", null),
    client,
  );

  if (missingPredictions.length === 0) {
    return { missing: 0, fixed: 0 }; // 欠落なし
  }

  console.log(
    `\n🔧 欠落した的中フラグを修正中... (${missingPredictions.length}件, ${startDate}〜${endDate})`,
  );

  // 結果データを取得（同様にページネーション）
  const results = await fetchAllRange(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio",
    (q) => q.gte("race_id", startDate).lt("race_id", `${endDate}~`),
    client,
  );

  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  let fixed = 0;
  for (const pred of missingPredictions) {
    const result = resultsMap.get(pred.race_id);
    if (!result || !result.rank1) continue;

    const isWinHit = pred.top_pick === result.rank1;
    const isPlaceHit =
      pred.top_pick === result.rank1 || pred.top_pick === result.rank2;

    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].sort(
      (a, b) => a - b,
    );
    const resultTop3 = [result.rank1, result.rank2, result.rank3].sort(
      (a, b) => a - b,
    );
    const isTrifectaHit =
      predTop3[0] === resultTop3[0] &&
      predTop3[1] === resultTop3[1] &&
      predTop3[2] === resultTop3[2];
    const isTrioHit =
      pred.top_pick === result.rank1 &&
      pred.top_2nd === result.rank2 &&
      pred.top_3rd === result.rank3;

    let payoutPlace = 0;
    if (isPlaceHit) {
      if (pred.top_pick === result.rank1) {
        payoutPlace = result.payout_place_1 || 0;
      } else if (pred.top_pick === result.rank2) {
        payoutPlace = result.payout_place_2 || 0;
      }
    }

    // 展開予測的中（unifiedモデルのみ。ADR 0013。judgeAndUpdateHits関数の同名の
    // 判定と同じくmodel_idを見ていない点・BOA-408後の挙動については同関数の
    // コメント参照）
    const turnPatterns = pred.feature_contributions?.turnPrediction?.patterns;
    const hasTurnPrediction =
      Array.isArray(turnPatterns) && turnPatterns.length > 0;
    const turnHit = hasTurnPrediction
      ? isTurnHit(turnPatterns, result.rank1)
      : null;

    const { error: updateError } = await client
      .from("predictions")
      .update({
        is_hit_win: isWinHit,
        is_hit_place: isPlaceHit,
        is_hit_trifecta: isTrifectaHit,
        is_hit_trio: isTrioHit,
        is_hit_turn: turnHit,
        payout_win: isWinHit ? result.payout_win : 0,
        payout_place: payoutPlace,
        payout_trifecta: isTrifectaHit ? result.payout_trifecta : 0,
        payout_trio: isTrioHit ? result.payout_trio : 0,
      })
      .eq("prediction_id", pred.prediction_id);

    if (!updateError) fixed++;
  }

  if (fixed > 0) {
    console.log(`  ✅ ${fixed}件の欠落フラグを修正`);
  }
  return { missing: missingPredictions.length, fixed };
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const targetDate = parseDateArg();
  scrapeResults(targetDate);
}
