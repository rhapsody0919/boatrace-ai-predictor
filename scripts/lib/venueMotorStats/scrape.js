/**
 * 会場別のモーター成績の取得（会場ごとの parser）・行の組み立て・venue_motor_stats への書き込み。
 * scripts/daily/scrape-venue-motor-stats.js から字のまま移した（CLI の入口は run を持ち、ここを再 export する。ハンドラー venueMotorStatsJob.js はここを読む）
 */

import * as cheerio from "cheerio";
import {
  parseGenericMotorTable,
} from "./parsers/genericTable.js";
import {
  parseGamagoriMotorTable,
} from "./parsers/gamagori.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = { "User-Agent": USER_AGENT };

/**
 * 会場ごとの取得・解析関数（parser 名 → 関数）を作る。
 * @param {typeof fetch} [fetchImpl] 既定は global fetch（GitHub Actions）。Vercel は politeFetch
 */
export function createParsers(fetchImpl = fetch) {
  async function fetchHtml(url) {
    const res = await fetchImpl(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.text();
  }

  return {
    genericTable: async (venue) => {
      const html = await fetchHtml(venue.url);
      return parseGenericMotorTable(cheerio.load(html));
    },
    gamagori: async (venue) => {
      const html = await fetchHtml(venue.url);
      return parseGamagoriMotorTable(cheerio.load(html));
    },
  };
}

const defaultParsers = createParsers();

/**
 * 1会場分を取得・解析する。失敗は例外にせず、{data: null, reason} で返す（従来の会場単位の成否と同じ）。
 * @param {{venueCode: number, name: string, parser: string}} venue
 * @param {{parsers?: ReturnType<typeof createParsers>, toReason?: (error: unknown) => string}} [options]
 * @returns {Promise<{data: Array<Object>|null, reason: string|null}>}
 */
export async function scrapeVenueMotorStats(
  venue,
  { parsers = defaultParsers, toReason = (error) => error.message } = {},
) {
  try {
    const parser = parsers[venue.parser];
    if (!parser) throw new Error(`unknown_parser:${venue.parser}`);
    const { data, reason } = await parser(venue);
    return { data: data ?? null, reason: data ? null : reason };
  } catch (error) {
    console.error(`  ❌ ${venue.name}: ${error.message}`);
    return { data: null, reason: toReason(error) };
  }
}

/** パーサーの1行を venue_motor_stats の行にする */
export function toMotorStatsRow(venue, m, scrapedDate) {
  return {
    venue_code: venue.venueCode,
    motor_number: m.motorNumber,
    scraped_date: scrapedDate,
    meet_count: m.meetCount,
    race_count: m.raceCount,
    final_count: m.finalCount,
    championship_count: m.championshipCount,
    first_place_count: m.firstPlaceCount,
    second_place_count: m.secondPlaceCount,
    third_place_count: m.thirdPlaceCount,
    win_rate: m.winRate,
    top2_rate: m.top2Rate,
    top3_rate: m.top3Rate,
    accident_rate: m.accidentRate,
    best_time: m.bestTime,
    avg_exhibition_time: m.avgExhibitionTime,
    stats_period_start: m.statsPeriodStart,
    stats_period_end: m.statsPeriodEnd,
    source_template: venue.parser,
  };
}

/**
 * venue_motor_stats へ書く（1,000行ずつ upsert）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Array<Object>} rows
 * @param {{throwOnError?: boolean}} [options] true（既定。BOA-391）なら、書き込みエラーを例外にする。
 *   false はログに出して続行する
 * @returns {Promise<number>} 書き込みに成功した行数
 */
export async function writeMotorStatsRows(
  client,
  rows,
  { throwOnError = true } = {},
) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await client
      .from("venue_motor_stats")
      .upsert(batch, { onConflict: "venue_code,motor_number,scraped_date" });
    if (error) {
      if (throwOnError) {
        throw new Error(`venue_motor_stats 書き込みエラー: ${error.message}`);
      }
      console.error(`❌ venue_motor_stats 書き込みエラー:`, error.message);
    } else {
      written += batch.length;
    }
  }
  return written;
}
