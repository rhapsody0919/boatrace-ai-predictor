// 進入コース別選手成績（venue_entry_course_stats）の取得・解析・書き込み。入口 scripts/daily/scrape-venue-entry-course-stats.js と
// 共通ラッパのハンドラー（venueEntryCourseStatsJob.js）が読む（lib が入口を読まないよう、入口から字のまま移した）
import { supabase, fetchAll } from "../supabaseClient.js";
import { buildEntryCourseUrl } from "./venueConfig.js";
import { parseEntryCourseHtml } from "./parser.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_TIMEOUT_MS = 15000;
// 同一会場ドメインへの連続リクエスト（最大12レース分）への配慮。
// 会場間（別ドメイン）は待機不要（venue_motor_stats.jsと同じ判断）
const SAME_VENUE_REQUEST_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTML取得関数を作る。失敗は短い理由コードの Error（http_XXX・timeout）にする。
 * @param {typeof fetch} [fetchImpl] 既定は global fetch（GitHub Actions）。Vercel は politeFetch
 */
export function createHtmlFetcher(fetchImpl = fetch) {
  return async function fetchHtml(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return await res.text();
    } catch (error) {
      if (error.name === "AbortError") throw new Error("timeout");
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

const fetchHtml = createHtmlFetcher();

// race_entries（当日の出走表）から (race_id, boat_number) -> racer_id の
// マップを作る。会場サイトは選手登録番号を掲載しないため、氏名一致ではなく
// 自社の出走表と突き合わせて解決する
async function buildRacerIdMap(raceIds, client = supabase) {
  if (raceIds.length === 0) return new Map();
  const rows = await fetchAll(
    "race_entries",
    "race_id,boat_number,racer_id",
    (q) => q.in("race_id", raceIds).order("race_id").order("boat_number"),
    { client },
  );
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.race_id}:${row.boat_number}`, row.racer_id ?? null);
  }
  return map;
}

// 1会場分の (race_id, boat_number) -> racer_id。取得に失敗しても空の Map で続ける
async function loadVenueRacerIdMap(venue, venueRaces, client) {
  const raceIds = venueRaces.map((r) => r.race_id);
  let racerIdMap;
  try {
    racerIdMap = await buildRacerIdMap(raceIds, client);
  } catch (error) {
    console.error(
      `  ⚠️ ${venue.name}: race_entries取得エラー（racer_idはNULLのまま続行）:`,
      error.message,
    );
    racerIdMap = new Map();
  }
  // race_entries（当日の出走表）が本日分まだ用意できていない場合、racer_idは
  // 全行NULLのまま静かに保存されうる（サイト側の構造は正常なため、この
  // scriptのhealth判定＝サイト構造監視には含めない。race_entries自体の欠損は
  // 別レイヤーの問題のため、ここではログでのみ可視化する）
  if (raceIds.length > 0 && racerIdMap.size === 0) {
    console.warn(
      `  ⚠️ ${venue.name}: race_entriesが本日分未登録の可能性（racer_idは全行NULLになります）`,
    );
  }
  return racerIdMap;
}

function toEntryCourseRow(venue, race, row, statsPeriod, racerIdMap) {
  return {
    race_id: race.race_id,
    venue_code: venue.venueCode,
    waku: row.waku,
    entry_course: row.entryCourse,
    racer_id: racerIdMap.get(`${race.race_id}:${row.waku}`) ?? null,
    racer_name_raw: row.racerNameRaw,
    entry_rate: row.entryRate,
    avg_st: row.avgSt,
    place_rate_1: row.placeRates[0],
    place_rate_2: row.placeRates[1],
    place_rate_3: row.placeRates[2],
    place_rate_4: row.placeRates[3],
    place_rate_5: row.placeRates[4],
    place_rate_6: row.placeRates[5],
    stats_period_start: statsPeriod.start,
    stats_period_end: statsPeriod.end,
  };
}

// 1レース分を取得・解析する（rows は会場の rows に足す）。reason は会場の最初の失敗の理由（venueReason を引き継ぎ、無ければこのレースの理由）
async function scrapeRace(
  venue,
  race,
  racerIdMap,
  { fetchHtmlImpl, toReason, venueReason },
) {
  const url = buildEntryCourseUrl(venue, race.race_no);
  const rows = [];
  try {
    const html = await fetchHtmlImpl(url);
    const { data, statsPeriod, reason } = parseEntryCourseHtml(html);
    if (!data) {
      console.log(
        `    ⚠️ ${venue.name} ${race.race_no}R: データなし (${reason})`,
      );
      return { rows, reason: venueReason ?? reason };
    }
    for (const row of data) {
      rows.push(toEntryCourseRow(venue, race, row, statsPeriod, racerIdMap));
    }
    return { rows, reason: venueReason };
  } catch (error) {
    const reason = venueReason ?? toReason(error);
    console.error(`    ❌ ${venue.name} ${race.race_no}R: ${error.message}`);
    return { rows, reason }; // 途中まで作った行も元のとおり残す
  }
}

/**
 * 1会場分（当日の全レース）を取得・解析して、書き込む行を返す。DBへは書かない（読み取りは race_entries のみ）。
 *
 * @param {{venueCode: number, name: string, baseUrl: string}} venue
 * @param {Array<{race_id: string, race_no: number}>} venueRaces 当日のその会場のレース
 * @param {Object} [options]
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {(url: string) => Promise<string>} [options.fetchHtmlImpl] 既定は global fetch
 * @param {number} [options.delayMs] 同一会場の連続リクエストの間隔（既定300ms）
 * @param {(error: unknown) => string} [options.toReason] 取得の例外を理由コードにする（既定は error.message）
 * @param {() => boolean} [options.shouldStop] true なら、以降のレースに着手しない（ソフトデッドライン）
 * @returns {Promise<{rows: Array<Object>, reason: string|null, stoppedEarly: boolean}>}
 *   reason: 1レースでも取得・解析に失敗した最初の理由（全レース成功なら null。従来の会場単位の成否）
 */
export async function scrapeVenue(
  venue,
  venueRaces,
  {
    client = supabase,
    fetchHtmlImpl = fetchHtml,
    delayMs = SAME_VENUE_REQUEST_DELAY_MS,
    toReason = (error) => error.message,
    shouldStop = () => false,
  } = {},
) {
  const racerIdMap = await loadVenueRacerIdMap(venue, venueRaces, client);

  const rows = [];
  let venueReason = null;
  let stoppedEarly = false;

  for (let i = 0; i < venueRaces.length; i++) {
    if (shouldStop()) {
      stoppedEarly = true;
      break;
    }
    const race = venueRaces[i];
    const got = await scrapeRace(venue, race, racerIdMap, {
      fetchHtmlImpl,
      toReason,
      venueReason,
    });
    rows.push(...got.rows);
    venueReason = got.reason;
    if (i < venueRaces.length - 1) await sleep(delayMs);
  }
  return { rows, reason: venueReason, stoppedEarly };
}

/**
 * venue_entry_course_stats へ書く（1,000行ずつ upsert）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Array<Object>} rows
 * @param {{throwOnError?: boolean}} [options] true（既定。BOA-391）なら、書き込みエラーを例外にする。
 *   false はログに出して続行する
 * @returns {Promise<number>} 書き込みに成功した行数
 */
export async function writeEntryCourseRows(
  client,
  rows,
  { throwOnError = true } = {},
) {
  let written = 0;
  // scraped_at は DEFAULT now() だが、DEFAULT は INSERT のときしか効かない。同じキーの行を
  // 繰り返し更新するため、載せないと初回挿入時の値が残り続ける（BOA-463）。
  // 差分判定を使わず毎回全行を書いているので、載せても書き込み量は増えない
  const scrapedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows
      .slice(i, i + 1000)
      .map((row) => ({ ...row, scraped_at: scrapedAt }));
    const { error } = await client
      .from("venue_entry_course_stats")
      .upsert(batch, { onConflict: "race_id,waku,entry_course" });
    if (error) {
      if (throwOnError) {
        throw new Error(
          `venue_entry_course_stats 書き込みエラー: ${error.message}`,
        );
      }
      console.error(
        `❌ venue_entry_course_stats 書き込みエラー:`,
        error.message,
      );
    } else {
      written += batch.length;
    }
  }
  return written;
}
