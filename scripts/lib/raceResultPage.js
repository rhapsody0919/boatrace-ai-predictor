/**
 * 結果ページ（raceresult）の取得・解析と、race_results に書く行の組み立て（scrape-results.js から分けた部分）。
 * DB には触れない（書くのは scrape-results.js）。呼び出し元はこれまでどおり scrape-results.js から import できる
 */
import { formatDateForUrl } from "./dateUtils.js";
import { parseRaceResultPage } from "./raceResultParser.js";
import { toLegacyResult } from "./raceResultRows.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { computeResultDigest } from "./scrapeJobs/resultDigest.js";
import {
  courseColumns,
  payoutColumns,
  popularityColumns,
  resultPayoutEntries,
} from "./raceResultRowParts.js";

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

export async function scrapeRaceResult(venueCode, raceNo, dateStr) {
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
  // 払戻・人気の引き当て（特払の扱いを含む）は raceResultRowParts.js の resultPayoutEntries
  const entries = resultPayoutEntries(result);

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
    ...payoutColumns(entries),
    ...popularityColumns(entries),
    winning_technique: result.winningTechnique,
    ...courseColumns(result.courseInfo),
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

/** 書いた race_start_timings の行の数（race_id ごと） */
function countTimingsByRace(rows) {
  const timingsWrittenByRace = new Map();
  for (const row of rows) {
    timingsWrittenByRace.set(
      row.race_id,
      (timingsWrittenByRace.get(row.race_id) ?? 0) + 1,
    );
  }
  return timingsWrittenByRace;
}

/** 取得できた1レースの outcome（ok / partial） */
function fetchedOutcome(
  { race, parsed, row },
  base,
  changedIds,
  timingsWrittenByRace,
) {
  // 不成立（全勝式が不成立）のレースは、決まり手が出ない・単勝の払戻が無いため、待っても揃わない。
  // 「決まり手が未公開」として毎分再取得し続けないよう、着順・払戻の表が読めた時点で完了とする
  const complete =
    isResultComplete(row) || parsed.full?.race_status === "no_race";
  return {
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
  };
}

/** runForRaces の 3) の後: 取得できたレースの outcome を、書き込みの結果から決める */
export function settleFetchedOutcomes(fetched, persisted, outcomes, base) {
  const changedIds = new Set(
    (persisted?.changedResults ?? []).map((r) => r.race_id),
  );
  const timingsWrittenByRace = countTimingsByRace(
    persisted?.startTimingRowsWritten ?? [],
  );
  for (const f of fetched) {
    if (persisted?.failed) continue; // 上で error を設定済み
    if (persisted?.errors?.length > 0) {
      outcomes.set(f.race.race_id, {
        ...base,
        rowsParsed: 1,
        outcome: "error",
        error: persisted.errors.map((e) => e.message).join(" / "),
      });
      continue;
    }
    outcomes.set(
      f.race.race_id,
      fetchedOutcome(f, base, changedIds, timingsWrittenByRace),
    );
  }
}

/** runForRaces の 2) の1レースぶん: 取得・解析して fetched に足すか、outcomes に失敗を入れる（1つの失敗で他を止めない） */
export async function fetchOneResult(
  race,
  { date, fetchHtml, now, outcomes, base, fetched },
) {
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
}
