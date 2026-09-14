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
    .gte("race_id", date)
    .lt("race_id", `${date}~`);

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
export function scrapeExhibitionData($) {
  const exhibitionData = [];
  const tables = $(".table1");
  if (tables.length < 2) {
    return { data: null, reason: `tables_lt_2 (found ${tables.length})` };
  }

  // 展示タイム・チルト・プロペラ交換・部品交換・調整重量（table[1]の各tbody、BOA-221で拡張）
  // 1艇あたりtbody内は4行（tr）構成: 1行目=枠/写真/選手名/体重/展示タイム/チルト/プロペラ/
  // 部品交換/前走成績R/前走成績レース番号、2行目=進入コース、3行目=調整重量(1列目)/ST/STタイム、
  // 4行目=着順。調整重量は1行目ではなく3行目の1列目にある（2026-09-14実データで確認、戸田・常滑）
  const exTable = tables.eq(1);
  const tbodies = exTable.find("tbody");

  tbodies.each((i, tbody) => {
    if (i >= 6) return;
    const rows = $(tbody).find("tr");
    if (rows.length < 1) return;

    const mainCells = rows.eq(0).find("td");
    const boatNumber = parseInt(mainCells.eq(0).text().trim());
    const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());
    const tilt = parseFloat(mainCells.eq(5).text().trim());
    const propellerText = mainCells.eq(6).text().trim();
    const partsChanged = mainCells
      .eq(7)
      .find("li")
      .map((_, li) => $(li).text().trim())
      .get()
      .filter(Boolean);
    const adjustmentWeight = parseFloat(
      rows.eq(2).find("td").eq(0).text().trim(),
    );

    if (boatNumber >= 1 && boatNumber <= 6) {
      exhibitionData.push({
        boatNumber,
        exhibitionTime:
          !isNaN(exhibitionTime) && exhibitionTime > 0 ? exhibitionTime : null,
        startTiming: null,
        tilt: !isNaN(tilt) ? tilt : null,
        propellerChange: propellerText || null,
        partsChanged: partsChanged.length > 0 ? partsChanged : null,
        adjustmentWeight: !isNaN(adjustmentWeight) ? adjustmentWeight : null,
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
 * オーケストレーターから呼び出し可能な展示データ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
/**
 * 展示データ取得のウィンドウ（BOA-55: 発走30分前・15分前・10分前）
 * existingExhibitionIds でスキップ制御するため広めに取っても二重取得なし。
 */
const EXHIBITION_WINDOWS = [30, 15, 10];

export async function run(schedule, date) {
  // BOA-55: 30分前（初回取得）・15分前・10分前（未取得時リトライ）のウィンドウをカバー
  const exhibitionTargetMap = new Map();
  for (const w of EXHIBITION_WINDOWS) {
    for (const r of getRacesInWindow(schedule, w, 3)) {
      exhibitionTargetMap.set(r.race_id, r);
    }
  }
  const windowRaces = [...exhibitionTargetMap.values()];

  if (windowRaces.length === 0) {
    console.log("📭 展示: 発走10〜33分前ウィンドウの対象レースなし");
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 展示データ取得: ${windowRaces.length}レース（発走30/15/10分前ウィンドウ）`,
  );

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
    console.log("📭 展示: 全レース取得済み（スキップ）");
    return { updated: false, count: 0 };
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
        fetchExhibitionForRace(date, venueCode, r.race_no).then(
          ({ data, reason }) => ({
            raceId: r.race_id,
            data,
            reason,
          }),
        ),
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
              tilt: ex.tilt,
              propeller_change: ex.propellerChange,
              parts_changed: ex.partsChanged,
              adjustment_weight: ex.adjustmentWeight,
            });
          }
        }
        venueFetched++;
      } else {
        console.log(
          `  ⚠️ ${venueName} ${parseInt(raceNo)}R: データなし (${reason})`,
        );
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
    console.log(`\n💾 exhibition_data: ${allRows.length}件書き込み中...`);

    // BOA-221の新列（tilt/propeller_change/parts_changed/adjustment_weight）は
    // マイグレーション（docs/db-migration/056_exhibition_data_tilt_parts.sql）適用が
    // 前提。未適用環境でこの新列を含むupsertがそのまま失敗すると、既存の
    // exhibition_time/start_timing（展示タイム）まで書き込めなくなり、既存機能を
    // 巻き添えで壊してしまう。列不在エラーを検知したら新列を除いたペイロードで
    // リトライし、既存機能だけは動かし続ける
    const NEW_COLUMNS = [
      "tilt",
      "propeller_change",
      "parts_changed",
      "adjustment_weight",
    ];
    const stripNewColumns = (batch) =>
      batch.map((row) => {
        const legacyRow = { ...row };
        NEW_COLUMNS.forEach((col) => delete legacyRow[col]);
        return legacyRow;
      });

    let legacyOnly = false;
    for (let i = 0; i < allRows.length; i += 1000) {
      const batch = allRows.slice(i, i + 1000);
      const payload = legacyOnly ? stripNewColumns(batch) : batch;
      const { error } = await supabase
        .from("exhibition_data")
        .upsert(payload, { onConflict: "race_id,boat_number" });

      if (
        error &&
        !legacyOnly &&
        /column .* does not exist/i.test(error.message)
      ) {
        console.warn(
          `⚠️ exhibition_data: 新列が未適用のため旧列のみでリトライします（マイグレーション056未適用の可能性）: ${error.message}`,
        );
        legacyOnly = true;
        const { error: retryError } = await supabase
          .from("exhibition_data")
          .upsert(stripNewColumns(batch), {
            onConflict: "race_id,boat_number",
          });
        if (retryError) {
          console.error(
            `❌ exhibition_data 書き込みエラー:`,
            retryError.message,
          );
        }
      } else if (error) {
        console.error(`❌ exhibition_data 書き込みエラー:`, error.message);
      }
    }

    console.log(`✅ exhibition_data: ${allRows.length}件完了`);
  } else {
    console.log("\n📭 展示: 新規データなし");
  }

  console.log(`📊 展示: 取得${totalFetched}R / データ${allRows.length}件`);
  return { updated: allRows.length > 0, count: allRows.length };
}

/**
 * メイン処理（スタンドアローン実行用）
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

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
