/**
 * 予測買い目オッズ取得スクリプト
 *
 * mainRefresh 後にオーケストレーターから呼ばれる（Step ⑥）。
 * Supabase から各レースの3モデル予測（top_pick/top_2nd/top_3rd）を取得し、
 * 対応する3連単・3連複オッズを odds3t/odds3f ページから取得して
 * prediction_odds テーブルに保存する。
 *
 * 取得対象: 3モデル × 2券種 = 最大6組（race_id ごとに1行 upsert）
 */

import * as cheerio from "cheerio";
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

// DB の model_id → prediction_odds カラムサフィックスへのマッピング
const MODEL_TO_COLUMN = {
  standard: "standard",
  safeBet: "safe_bet",
  upsetFocus: "upset_focus",
};

/**
 * Supabase から対象レースの予測を取得
 * @param {string[]} raceIds
 * @returns {Promise<Map<string, Object>>} race_id -> { standard, safeBet, upsetFocus }
 */
async function fetchPredictions(raceIds) {
  const { data, error } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd")
    .in("race_id", raceIds)
    .eq("is_shadow", false);

  if (error) {
    console.error("  ⚠️ 予測データ取得エラー:", error.message);
    return new Map();
  }

  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.race_id)) map.set(row.race_id, {});
    if (MODEL_TO_COLUMN[row.model_id]) {
      map.get(row.race_id)[row.model_id] = {
        top1: row.top_pick,
        top2: row.top_2nd,
        top3: row.top_3rd,
      };
    }
  }
  return map;
}

/**
 * odds3t ページから全120通りの3連単オッズをパース
 * セレクタ: .is-p3-0 tbody tr（scrape-odds.js と同じ構造）
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2-3" -> odds
 */
function parseTrifectaAll($) {
  const map = new Map();
  $(".is-p3-0 tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const raw = $(cells[0]).text().trim();
    const key = raw.replace(/[－ー−\s]/g, "-").replace(/-{2,}/g, "-");
    const oddsText = $(cells[cells.length - 1])
      .text()
      .trim();
    const odds = parseFloat(oddsText);
    if (key && /^\d-\d-\d$/.test(key) && !isNaN(odds) && odds > 0) {
      map.set(key, odds);
    }
  });
  return map;
}

/**
 * odds3f ページから全3連複オッズをパース
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2-3"（昇順ソート済み）-> odds
 */
function parseTrioAll($) {
  const map = new Map();
  $(".is-p3-0 tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const raw = $(cells[0]).text().trim();
    const normalized = raw.replace(/[－ー−\s]/g, "-").replace(/-{2,}/g, "-");
    const oddsText = $(cells[cells.length - 1])
      .text()
      .trim();
    const odds = parseFloat(oddsText);
    if (
      normalized &&
      /^\d-\d-\d$/.test(normalized) &&
      !isNaN(odds) &&
      odds > 0
    ) {
      // 3連複は順不同のため艇番を昇順ソートして正規化
      const sorted = normalized
        .split("-")
        .map(Number)
        .sort((a, b) => a - b)
        .join("-");
      map.set(sorted, odds);
    }
  });
  return map;
}

/**
 * 3連複の買い目キーを生成（昇順ソート）
 */
function trioKey(b1, b2, b3) {
  return [b1, b2, b3].sort((a, b) => a - b).join("-");
}

/**
 * 1レースの予測買い目オッズを取得
 * @param {string} date - YYYY-MM-DD
 * @param {number} venueCode
 * @param {number} raceNo
 * @param {Object} modelPredictions - { standard, safeBet, upsetFocus }
 * @returns {Promise<Object|null>}
 */
async function fetchPredictionOddsForRace(
  date,
  venueCode,
  raceNo,
  modelPredictions,
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const trifUrl = `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const trioUrl = `https://www.boatrace.jp/owpc/pc/race/odds3f?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  let trifMap = new Map();
  let trioMap = new Map();

  try {
    const [trifRes, trioRes] = await Promise.all([
      fetch(trifUrl, { headers: FETCH_HEADERS }),
      fetch(trioUrl, { headers: FETCH_HEADERS }),
    ]);

    if (trifRes.ok) {
      trifMap = parseTrifectaAll(cheerio.load(await trifRes.text()));
    } else {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R odds3t HTTP ${trifRes.status}`,
      );
    }

    if (trioRes.ok) {
      trioMap = parseTrioAll(cheerio.load(await trioRes.text()));
    } else {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R odds3f HTTP ${trioRes.status}`,
      );
    }
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R オッズ取得エラー: ${err.message}`,
    );
    return null;
  }

  if (trifMap.size === 0 && trioMap.size === 0) return null;

  const row = { updated_at: new Date().toISOString() };

  for (const [modelId, colSuffix] of Object.entries(MODEL_TO_COLUMN)) {
    const pred = modelPredictions[modelId];
    if (!pred?.top1 || !pred?.top2 || !pred?.top3) continue;

    const { top1, top2, top3 } = pred;

    // 3連単: 1着→2着→3着の順通り
    const tfKey = `${top1}-${top2}-${top3}`;
    row[`trifecta_pred_${colSuffix}`] = tfKey;
    row[`trifecta_odds_${colSuffix}`] = trifMap.get(tfKey) ?? null;

    // 3連複: 艇番を昇順ソート
    const tkKey = trioKey(top1, top2, top3);
    row[`trio_pred_${colSuffix}`] = tkKey;
    row[`trio_odds_${colSuffix}`] = trioMap.get(tkKey) ?? null;
  }

  const oddsFound = Object.values(MODEL_TO_COLUMN).filter(
    (s) => row[`trifecta_odds_${s}`] != null || row[`trio_odds_${s}`] != null,
  ).length;

  const vname = VENUE_NAMES[venueCode] || `会場${venueCode}`;
  console.log(
    `  ${oddsFound > 0 ? "✅" : "⚠️ "} ${vname} ${raceNo}R` +
      ` — 3連単: ${row.trifecta_odds_standard ?? "-"}倍` +
      ` / 3連複: ${row.trio_odds_standard ?? "-"}倍`,
  );

  return row;
}

/**
 * オーケストレーターから呼び出し可能なエントリポイント
 * @param {string[]} raceIds - mainRefresh で更新したレース ID 一覧
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(raceIds, date) {
  if (!raceIds || raceIds.length === 0) {
    return { updated: false, count: 0 };
  }

  // 予測データ取得
  const predictionsMap = await fetchPredictions(raceIds);
  if (predictionsMap.size === 0) {
    console.log("📭 予測買い目オッズ: 予測データなし → スキップ");
    return { updated: false, count: 0 };
  }

  console.log(`🎯 予測買い目オッズ取得: ${predictionsMap.size}レース`);

  const upsertRows = [];

  // race_id から venue_code / race_no を抽出（"YYYY-MM-DD-VV-RR" 形式）
  for (const [raceId, modelPredictions] of predictionsMap) {
    const parts = raceId.split("-");
    if (parts.length < 5) {
      console.warn(`  ⚠️ 無効な race_id: ${raceId}`);
      continue;
    }
    const venueCode = parseInt(parts[3], 10);
    const raceNo = parseInt(parts[4], 10);
    if (isNaN(venueCode) || isNaN(raceNo)) {
      console.warn(`  ⚠️ venue/race 解析失敗: ${raceId}`);
      continue;
    }

    const row = await fetchPredictionOddsForRace(
      date,
      venueCode,
      raceNo,
      modelPredictions,
    );
    if (!row) continue;

    upsertRows.push({ race_id: raceId, ...row });

    // 会場間スロットリング（1レース毎に 300ms）
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (upsertRows.length === 0) {
    console.log("\n📭 予測買い目オッズ: 書き込みデータなし");
    return { updated: false, count: 0 };
  }

  console.log(`\n💾 prediction_odds: ${upsertRows.length}件 upsert 中...`);
  const { error } = await supabase
    .from("prediction_odds")
    .upsert(upsertRows, { onConflict: "race_id" });

  if (error) {
    console.error("❌ prediction_odds 書き込みエラー:", error.message);
    return { updated: false, count: 0 };
  }

  console.log(`✅ prediction_odds: ${upsertRows.length}件完了`);
  return { updated: true, count: upsertRows.length };
}

/**
 * スタンドアローン実行用（デバッグ・手動実行）
 */
async function main() {
  console.log("🎯 予測買い目オッズ取得開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }

  const raceIds = schedule.map((r) => r.race_id);
  await run(raceIds, date);
  console.log("🏁 完了");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
