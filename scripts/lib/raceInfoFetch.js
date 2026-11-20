/**
 * 出走表・直前情報の取得（update-race-info.js から分けた部分）: racelist・beforeinfo を取って読む。
 * DB には触れない（書くのは update-race-info.js）。呼び出し元はこれまでどおり update-race-info.js から import できる
 */
import * as cheerio from "cheerio";
import { VENUE_NAMES } from "./venueNames.js";
import { parseRaceListPage } from "./raceListParser.js";
import { scrapeConditions } from "./beforeinfoWeather.js";
import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};
export const defaultFetch = (url) => fetch(url, { headers: FETCH_HEADERS });

/** fetchFn の失敗を、取得の結果の種別にする（サーキットブレーカーが開いていた場合は、再試行の時刻つき） */
function failureOf(error) {
  if (error instanceof BreakerOpenError) {
    return {
      status: "breaker_open",
      error: error.message,
      retryAt: new Date(error.until),
    };
  }
  return { status: "error", error: error?.message ?? String(error) };
}

/**
 * 1レースの出走表（racelist）を取得・解析する。includeWeather=true のときだけ、直前情報（beforeinfo）も
 * 並列に取得して気象を解析する（従来の run の動作）。Vercel の api/cron/race-info.js は、beforeinfo を展示（A2）が
 * 1回で全項目を取得するため、includeWeather=false で呼ぶ（D2: beforeinfo の重複取得の解消。気象は展示の取得時の値）。
 *
 * @param {string} date YYYY-MM-DD
 * @param {number} venueCode
 * @param {number} raceNo
 * @param {{fetchFn?: (url: string) => Promise<Response>, includeWeather?: boolean}} [options]
 * @returns {Promise<
 *   | {status: "ok", page: ReturnType<typeof parseRaceListPage>, conditions: Object|null}
 *   | {status: "no_entries", page: ReturnType<typeof parseRaceListPage>}
 *   | {status: "http_error"|"error", error: string}
 *   | {status: "breaker_open", error: string, retryAt: Date}
 * >}
 *   no_entries: ページは取得できたが、選手が1人も取れない（中止・未公開の可能性）
 */
export async function fetchRaceInfoDetailed(
  date,
  venueCode,
  raceNo,
  { fetchFn = defaultFetch, includeWeather = true } = {},
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const query = `rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const racelistUrl = `https://www.boatrace.jp/owpc/pc/race/racelist?${query}`;
  const beforeinfoUrl = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?${query}`;
  // fetchFn が同期的に例外を投げても、もう一方の取得を巻き込まないよう Promise にそろえる
  const settle = (url) =>
    Promise.resolve()
      .then(() => fetchFn(url))
      .then(
        (response) => ({ response }),
        (error) => ({ error }),
      );

  const [list, before] = await Promise.all([
    settle(racelistUrl),
    includeWeather ? settle(beforeinfoUrl) : Promise.resolve(null),
  ]);
  if (list.error) return failureOf(list.error);
  if (!list.response.ok) {
    return { status: "http_error", error: `HTTP ${list.response.status}` };
  }

  let page;
  try {
    // 出走表は、全項目を1回で解析する（scripts/lib/raceListParser.js）
    page = parseRaceListPage(await list.response.text());
  } catch (error) {
    return failureOf(error);
  }
  // 選手が1人も取得できない場合は中止・未公開の可能性
  if (page.entries.length === 0) return { status: "no_entries", page };

  let conditions = null;
  if (includeWeather && before?.response?.ok) {
    try {
      conditions = scrapeConditions(cheerio.load(await before.response.text()));
    } catch (error) {
      // 気象の解析・取得の失敗は、出走表の保存を妨げない（気象を含めずに書く）
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 気象の解析に失敗: ${error.message}`,
      );
    }
  }
  return { status: "ok", page, conditions };
}

/**
 * 1レースの racelist + beforeinfo を並列取得（従来の run の入口。失敗は null に丸めてログに出す）
 */
export async function fetchRaceInfo(date, venueCode, raceNo, options = {}) {
  const detail = await fetchRaceInfoDetailed(date, venueCode, raceNo, options);
  const name = `${VENUE_NAMES[venueCode]} ${raceNo}R`;
  if (detail.status === "ok") return detail;
  if (detail.status === "no_entries") {
    console.warn(`  ⚠️ ${name} 選手情報なし（中止・未公開の可能性）`);
  } else if (detail.status === "http_error") {
    console.error(`  ❌ ${name} racelist 取得失敗 ${detail.error}`);
  } else {
    console.error(`  ❌ ${name} 取得エラー: ${detail.error}`);
  }
  return null;
}

/** runForRaces の取得・解析（1つの失敗で他のレースを止めない）。{race, detail} の配列 */
export function fetchRaceInfos(
  races,
  { date, concurrency, fetchFn, includeWeather },
) {
  return mapWithConcurrency(races, concurrency, async (race) => ({
    race,
    detail: await fetchRaceInfoDetailed(
      date,
      race.venue_code,
      race.race_number,
      { fetchFn, includeWeather },
    ),
  }));
}
