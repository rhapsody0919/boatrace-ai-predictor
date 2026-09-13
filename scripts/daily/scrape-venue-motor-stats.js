/**
 * 会場公式サイトのモーター成績（節数・出走回数・優出回数・優勝回数等）を
 * 日次で取得し、venue_motor_stats テーブルに保存する（BOA-264）。
 *
 * 対象は全24会場中22会場（戸田・平和島は該当データ自体が存在しないため対象外）。
 * 会場ごとにテンプレートが異なるため、venueConfig.jsのparser指定に従って
 * scripts/lib/venueMotorStats/parsers/ 配下の対応パーサーを呼び分ける。
 *
 * 実行時間: 会場数分のHTTPリクエスト（22件）+ 宮島のPDF解決1件、直列実行で
 * 会場間1秒待機するため約1分程度を想定。
 */
import * as cheerio from "cheerio";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTodayDateJST } from "../lib/dateUtils.js";
import {
  VENUE_MOTOR_STATS_CONFIG,
  EXCLUDED_VENUES,
} from "../lib/venueMotorStats/venueConfig.js";
import { parseGenericMotorTable } from "../lib/venueMotorStats/parsers/genericTable.js";
import { parseGamagoriMotorTable } from "../lib/venueMotorStats/parsers/gamagori.js";
import { parseMiyajimaMotorPdf } from "../lib/venueMotorStats/parsers/miyajimaPdf.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = { "User-Agent": USER_AGENT };

async function fetchHtml(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
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
  return pdfHref;
}

async function fetchAndParse(venue) {
  if (venue.parser === "miyajimaPdf") {
    const pdfUrl = await resolveMiyajimaPdfUrl(venue.listingUrl);
    if (!pdfUrl) return { data: null, reason: "pdf_link_not_found" };
    const res = await fetch(pdfUrl, { headers: FETCH_HEADERS });
    if (!res.ok) return { data: null, reason: `http_${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    return parseMiyajimaMotorPdf(buffer);
  }

  const html = await fetchHtml(venue.url);
  const $ = cheerio.load(html);

  if (venue.parser === "gamagori") {
    return parseGamagoriMotorTable($);
  }
  return parseGenericMotorTable($);
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

  for (let i = 0; i < VENUE_MOTOR_STATS_CONFIG.length; i++) {
    const venue = VENUE_MOTOR_STATS_CONFIG[i];
    try {
      const { data, reason } = await fetchAndParse(venue);
      if (!data) {
        console.log(`  ⚠️ ${venue.name}: データなし (${reason})`);
      } else {
        for (const m of data) {
          allRows.push({
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
          });
        }
        console.log(`  ✅ ${venue.name}: ${data.length}件`);
        successCount++;
      }
    } catch (error) {
      console.error(`  ❌ ${venue.name}: ${error.message}`);
    }

    if (i < VENUE_MOTOR_STATS_CONFIG.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (allRows.length > 0) {
    console.log(`\n💾 venue_motor_stats: ${allRows.length}件書き込み中...`);
    for (let i = 0; i < allRows.length; i += 1000) {
      const batch = allRows.slice(i, i + 1000);
      const { error } = await supabase
        .from("venue_motor_stats")
        .upsert(batch, { onConflict: "venue_code,motor_number,scraped_date" });
      if (error) {
        console.error(`❌ venue_motor_stats 書き込みエラー:`, error.message);
      }
    }
  }

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
