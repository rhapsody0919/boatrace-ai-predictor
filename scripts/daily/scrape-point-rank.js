/**
 * 今節得点率取得スクリプト（BOA-220/BOA-291、FR-3）
 *
 * boatrace.jp「得点率一覧」ページ（pointrank）を、開催中の全会場に対して
 * 1日1回取得する。SG/G1等の記念競走（予選勝ち上がり制）でのみデータが
 * 存在し、一般戦・特別選抜競走（オールレディース/マスターズ等）は
 * ページ自体にテーブルが無い（scripts/lib/pointRankParser.js参照）。
 * 対象グレードを事前に決め打ちせず、テーブルの有無で判定する。
 *
 * meet_start_date（開催初日）は race_conditions.series_day（BOA-226）を
 * 使って対象日から逆算する。series_day未取得（発走60分前ウィンドウ未到達、
 * update-race-info.jsの一時的な取得失敗等）の会場はその日の取得をスキップする。
 * 本ジョブは常に「今日」のpointrankページのみを対象とするため、
 * 過去日を狙い直す再試行の仕組みは無い（スキップした日は永久に欠落する）。
 *
 * GitHub Actionsから日次実行（低頻度・T4相当、BOA-313の対象外）。
 */

import * as cheerio from "cheerio";
import {
  getTodayDateJST,
  parseDateArg,
  addDaysToDateString,
  extractVenueCodeFromRaceId,
} from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { parsePointRankTable } from "../lib/pointRankParser.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/**
 * 対象日に開催中の会場コードとレースグレードのMapを取得
 * @returns {Promise<Map<number, string|null>>} venueCode -> race_grade
 */
async function getActiveVenueGrades(date) {
  const { data, error } = await supabase
    .from("races")
    .select("race_id, race_grade")
    .like("race_id", `${date}%`);
  if (error) {
    console.error("⚠️ 開催会場一覧の取得エラー:", error.message);
    return new Map();
  }
  const venueGrades = new Map();
  for (const r of data || []) {
    venueGrades.set(extractVenueCodeFromRaceId(r.race_id), r.race_grade);
  }
  return venueGrades;
}

/**
 * 対象日・会場の series_day を race_conditions から取得し、
 * 開催初日（meet_start_date）を逆算する
 */
async function getMeetStartDate(date, venueCode) {
  const jcd = String(venueCode).padStart(2, "0");
  const { data, error } = await supabase
    .from("race_conditions")
    .select("race_id, series_day")
    .like("race_id", `${date}-${jcd}-%`)
    .not("series_day", "is", null)
    .order("race_id")
    .limit(1);
  if (error || !data || data.length === 0) return null;

  const seriesDay = data[0].series_day;
  return addDaysToDateString(date, -(seriesDay - 1));
}

/**
 * 1会場分の得点率一覧を取得・パース
 */
async function fetchPointRank(date, venueCode) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/pointrank?jcd=${jcd}&hd=${ymd}`;

  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} pointrank 取得失敗 HTTP ${res.status}`,
      );
      return null;
    }
    const $ = cheerio.load(await res.text());
    return parsePointRankTable($);
  } catch (err) {
    console.error(`  ❌ ${VENUE_NAMES[venueCode]} 取得エラー:`, err.message);
    return null;
  }
}

/**
 * オーケストレーターから呼び出し可能な得点率更新処理
 * @param {string} [date] - YYYY-MM-DD（省略時は今日のJST日付）
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(date) {
  const targetDate = date || getTodayDateJST();
  const venueGrades = await getActiveVenueGrades(targetDate);
  if (venueGrades.size === 0) {
    console.log(`📭 得点率: ${targetDate} の開催会場なし`);
    return { updated: false, count: 0 };
  }

  const rows = [];
  for (const venueCode of [...venueGrades.keys()].sort((a, b) => a - b)) {
    const rankRows = await fetchPointRank(targetDate, venueCode);
    if (!rankRows) continue;

    const meetStartDate = await getMeetStartDate(targetDate, venueCode);
    if (!meetStartDate) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} series_day未取得のためスキップ（本日分は再取得されない）`,
      );
      continue;
    }

    for (const r of rankRows) {
      rows.push({
        venue_code: venueCode,
        meet_start_date: meetStartDate,
        racer_id: r.racerId,
        race_grade: venueGrades.get(venueCode) ?? null,
        player_name: r.playerName,
        grade: r.grade,
        rank: r.rank,
        score_rate: r.scoreRate,
        placements: r.placements,
        total_points: r.totalPoints,
        penalty_points: r.penaltyPoints,
        remarks: r.remarks,
      });
    }
    console.log(
      `  ✅ ${VENUE_NAMES[venueCode]}: ${rankRows.length}名（開催初日${meetStartDate}）`,
    );

    // 会場間1秒待機（サーバー負荷配慮）
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (rows.length === 0) {
    console.log("📭 得点率: 書き込みデータなし（対象開催が一般戦のみ等）");
    return { updated: false, count: 0 };
  }

  const { error } = await supabase
    .from("racer_series_points")
    .upsert(rows, { onConflict: "venue_code,meet_start_date,racer_id" });
  if (error) {
    console.error("❌ racer_series_points 書き込みエラー:", error.message);
    return { updated: false, count: 0 };
  }

  console.log(`💾 racer_series_points: ${rows.length}件`);
  return { updated: true, count: rows.length };
}

async function main() {
  console.log("📋 得点率取得開始");
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }
  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);
  await run(date);
  console.log("🏁 完了");
}

export const _internal = { getActiveVenueGrades, getMeetStartDate };

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
