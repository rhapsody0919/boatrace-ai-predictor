/**
 * 会場公式サイトのモーター成績（節数・出走回数・優出回数・優勝回数等）を
 * 日次で取得し、venue_motor_stats テーブルに保存する（BOA-264）。
 *
 * 対象は全24会場中22会場（戸田・平和島は該当データ自体が存在しないため対象外）。
 * 会場ごとにテンプレートが異なるため、venueConfig.jsのparser指定に従って
 * scripts/lib/venueMotorStats/parsers/ 配下の対応パーサーを呼び分ける。
 *
 * 実行時間: 会場数分のHTTPリクエスト（22件）+ 宮島のPDF解決1件。各会場は
 * 完全に別ドメインのため会場間の待機は不要（同一ドメインへの連続アクセスでは
 * ないため、他会場のレート制限に配慮する理由がない）。
 * 本ファイルの run() は GitHub Actions（逐次）用。Vercel の日次ジョブは、同じ取得・解析・行の組み立て
 * （createParsers・scrapeVenueMotorStats・toMotorStatsRow・writeMotorStatsRows）を
 * scripts/lib/venueMotorStatsJob.js から、同時取得・politeFetch・履歴をlast_reportへ、の形で使う。
 */
import * as cheerio from "cheerio";
import fs from "node:fs";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTodayDateJST } from "../lib/dateUtils.js";
import {
  VENUE_MOTOR_STATS_CONFIG,
  EXCLUDED_VENUES,
} from "../lib/venueMotorStats/venueConfig.js";
import { parseGenericMotorTable } from "../lib/venueMotorStats/parsers/genericTable.js";
import { parseGamagoriMotorTable } from "../lib/venueMotorStats/parsers/gamagori.js";
import { parseMiyajimaMotorPdf } from "../lib/venueMotorStats/parsers/miyajimaPdf.js";
import { updateVenueHealth } from "../lib/venueMotorStats/driftHealth.js";

const HEALTH_FILE_PATH = new URL(
  "../../data/analysis/venue-motor-stats-health.json",
  import.meta.url,
);

function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    return {};
  }
}

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

  // 宮島は「前検日」ごとにPDFのファイル名が変わるため、まず一覧ページから
  // 「モーター成績集計表」リンクを解決してからPDFを取得する
  async function resolveMiyajimaPdfUrl(listingUrl) {
    const html = await fetchHtml(listingUrl);
    const $ = cheerio.load(html);

    // 実データ確認済みの構造:
    // <div class="int"><div class="left"><p class="txt">モーター成績集計表　前検日</p>
    // </div><a href="....pdf" class="race_dl_bt">DOWNLOAD</a></div>
    // キャプション<p>と実際のダウンロードリンク<a>は兄弟要素（共通の親div.int配下）
    let pdfHref = null;
    $("p").each((_, p) => {
      if (!$(p).text().includes("モーター成績集計表")) return;
      const href = $(p).closest(".int").find("a[href*='.pdf']").attr("href");
      if (href) {
        pdfHref = href;
        return false;
      }
    });
    if (pdfHref) return new URL(pdfHref, listingUrl).href;
    return null;
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
    miyajimaPdf: async (venue) => {
      const pdfUrl = await resolveMiyajimaPdfUrl(venue.listingUrl);
      if (!pdfUrl) return { data: null, reason: "pdf_link_not_found" };
      const res = await fetchImpl(pdfUrl, { headers: FETCH_HEADERS });
      if (!res.ok) return { data: null, reason: `http_${res.status}` };
      const buffer = Buffer.from(await res.arrayBuffer());
      return parseMiyajimaMotorPdf(buffer);
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
 * @param {{throwOnError?: boolean}} [options] true なら、書き込みエラーを例外にする（Vercel）。
 *   既定は従来どおり、ログに出して続行する
 * @returns {Promise<number>} 書き込みに成功した行数
 */
export async function writeMotorStatsRows(
  client,
  rows,
  { throwOnError = false } = {},
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

export async function run() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    return { updated: false, count: 0 };
  }

  const scrapedDate = getTodayDateJST();
  console.log(`🚗 会場別モーター成績スクレイピング開始 (${scrapedDate})`);
  console.log(`📭 対象外: ${Object.values(EXCLUDED_VENUES).join(" / ")}`);

  const allRows = [];
  let successCount = 0;
  const health = loadHealth();

  for (let i = 0; i < VENUE_MOTOR_STATS_CONFIG.length; i++) {
    const venue = VENUE_MOTOR_STATS_CONFIG[i];
    const { data, reason } = await scrapeVenueMotorStats(venue);
    health[venue.venueCode] = updateVenueHealth(health[venue.venueCode], {
      success: !!data,
      reason: data ? null : reason,
      date: scrapedDate,
    });
    if (!data) {
      console.log(`  ⚠️ ${venue.name}: データなし (${reason})`);
    } else {
      for (const m of data) allRows.push(toMotorStatsRow(venue, m, scrapedDate));
      console.log(`  ✅ ${venue.name}: ${data.length}件`);
      successCount++;
    }
  }

  if (allRows.length > 0) {
    console.log(`\n💾 venue_motor_stats: ${allRows.length}件書き込み中...`);
    await writeMotorStatsRows(supabase, allRows);
  }

  fs.mkdirSync(new URL(".", HEALTH_FILE_PATH), { recursive: true });
  fs.writeFileSync(HEALTH_FILE_PATH, JSON.stringify(health, null, 2) + "\n");

  console.log(
    `📊 完了: ${successCount}/${VENUE_MOTOR_STATS_CONFIG.length}会場成功、${allRows.length}件保存`,
  );
  return { updated: allRows.length > 0, count: allRows.length };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
