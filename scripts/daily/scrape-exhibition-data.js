/**
 * 展示データ専用軽量スクレイピングスクリプト
 *
 * beforeinfo ページから展示タイム・展示STのみを取得し、
 * Supabase exhibition_data テーブルに直接 upsert する。
 * data/races.json には一切触れない。
 *
 * 実行時間: 約3-4分（取得済みレースはスキップ）
 */

import * as cheerio from "cheerio";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/**
 * Supabase から取得済みの展示データがある race_id セットを取得
 */
async function getExistingExhibitionRaceIds(date) {
  if (!isSupabaseEnabled()) return new Set();

  const { data, error } = await supabase
    .from("exhibition_data")
    .select("race_id")
    .like("race_id", `${date}%`);

  if (error) {
    console.error("⚠️ 取得済みデータの確認に失敗:", error.message);
    return new Set();
  }

  return new Set(data.map((r) => r.race_id));
}

/**
 * beforeinfo ページから展示データをスクレイピング
 * @returns {{ data: Array|null, reason: string|null }}
 *   reason: 'tables_lt_2' | 'no_boats' | 'no_values' | null(成功)
 */
function scrapeExhibitionData($) {
  const exhibitionData = [];
  const tables = $(".table1");
  if (tables.length < 2) {
    return { data: null, reason: `tables_lt_2 (found ${tables.length})` };
  }

  // 展示タイム（table[1]の各tbody）
  const exTable = tables.eq(1);
  const tbodies = exTable.find("tbody");

  tbodies.each((i, tbody) => {
    if (i >= 6) return;
    const rows = $(tbody).find("tr");
    if (rows.length < 1) return;

    const mainCells = rows.eq(0).find("td");
    const boatNumber = parseInt(mainCells.eq(0).text().trim());
    const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());

    if (boatNumber >= 1 && boatNumber <= 6) {
      exhibitionData.push({
        boatNumber,
        exhibitionTime:
          !isNaN(exhibitionTime) && exhibitionTime > 0 ? exhibitionTime : null,
        startTiming: null,
      });
    }
  });

  if (exhibitionData.length === 0) {
    return { data: null, reason: `no_boats (tbodies=${tbodies.length})` };
  }

  // 展示ST（table[2]）
  if (tables.length >= 3) {
    const startTable = tables.eq(2);
    startTable.find(".table1_boatImage1").each((i, el) => {
      const boatText =
        $(el).find(".table1_boatImage1Number").text().trim() ||
        $(el).text().trim().split("\n")[0].trim();
      const boatNum = parseInt(boatText);

      const stText = $(el).find(".table1_boatImage1Time").text().trim();
      const isFlying = stText.includes("F");
      const numMatch = stText.match(/[FL]?\.(\d+)/);
      const stValue = numMatch ? parseFloat("0." + numMatch[1]) : null;

      if (boatNum >= 1 && boatNum <= 6 && stValue !== null) {
        const entry = exhibitionData.find((e) => e.boatNumber === boatNum);
        if (entry) {
          entry.startTiming = stValue;
          entry.isFlying = isFlying;
        }
      }
    });
  }

  const hasData = exhibitionData.some(
    (e) => e.exhibitionTime !== null || e.startTiming !== null,
  );
  if (!hasData) {
    return { data: null, reason: `no_values (boats=${exhibitionData.length})` };
  }
  return { data: exhibitionData, reason: null };
}

/**
 * 1レースの展示データを取得
 * @returns {{ data: Array|null, reason: string|null }}
 */
async function fetchExhibitionForRace(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  try {
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      return { data: null, reason: `http_${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    return scrapeExhibitionData($);
  } catch (error) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R: ${error.message}`,
    );
    return { data: null, reason: `error: ${error.message}` };
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log("🚀 展示データ専用スクレイピング開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  // 発走30分前ウィンドウのレースのみ対象
  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  // ±15分ウィンドウ（15〜45分前）: 展示データ公開タイミング（発走18〜22分前）を確実にカバー
  // 旧: ±8分（22〜38分前）→ 展示データ公開直後にウィンドウ外になるケースが発生
  const windowRaces = getRacesInWindow(schedule, 30, 15);
  if (windowRaces.length === 0) {
    console.log("📭 発走15〜45分前ウィンドウの対象レースなし");
    return;
  }
  console.log(`🎯 取得対象: ${windowRaces.length}レース（発走22〜38分前ウィンドウ）`);

  // 展示データ取得済みの race_id（スキップ判定用）
  const existingExhibitionIds = await getExistingExhibitionRaceIds(date);

  // 会場ごとにグループ化
  const byVenue = new Map();
  for (const r of windowRaces) {
    if (existingExhibitionIds.has(r.race_id)) continue; // 取得済みはスキップ
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  if (byVenue.size === 0) {
    console.log("📭 全レース取得済み（スキップ）");
    return;
  }

  let totalFetched = 0;
  const allRows = [];

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全対象レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchExhibitionForRace(date, venueCode, r.race_no).then(({ data, reason }) => ({
          raceId: r.race_id,
          data,
          reason,
        })),
      ),
    );

    let venueFetched = 0;
    for (const { raceId, data, reason } of results) {
      const raceNo = raceId.split("-")[4];
      if (data) {
        for (const ex of data) {
          if (ex.exhibitionTime != null || ex.startTiming != null) {
            allRows.push({
              race_id: raceId,
              boat_number: ex.boatNumber,
              exhibition_time: ex.exhibitionTime,
              start_timing: ex.startTiming,
            });
          }
        }
        venueFetched++;
      } else {
        console.log(`  ⚠️ ${venueName} ${parseInt(raceNo)}R: データなし (${reason})`);
      }
    }

    if (venueFetched > 0) {
      console.log(`  ✅ ${venueName}: ${venueFetched}R 取得`);
    }
    totalFetched += venueFetched;

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Supabase に upsert
  if (allRows.length > 0) {
    console.log(`\n💾 Supabase に ${allRows.length} 件を書き込み中...`);

    for (let i = 0; i < allRows.length; i += 1000) {
      const batch = allRows.slice(i, i + 1000);
      const { error } = await supabase
        .from("exhibition_data")
        .upsert(batch, { onConflict: "race_id,boat_number" });

      if (error) {
        console.error(`❌ exhibition_data 書き込みエラー:`, error.message);
      }
    }

    console.log(`✅ ${allRows.length}件 書き込み完了`);
  } else {
    console.log("\n📭 新規データなし");
  }

  console.log(`\n📊 結果: 取得${totalFetched}R / データ${allRows.length}件`);
  console.log("🏁 完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
