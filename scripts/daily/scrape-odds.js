/**
 * レース前オッズ取得スクリプト
 *
 * 発走60/30/15/10/5分前のウィンドウで単勝・3連単オッズを取得し、
 * Supabase race_odds テーブルに upsert する。
 *
 * scrape-scheduled.yml から5分毎に実行される。
 * 実装パターン: scrape-exhibition-data.js に準拠
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

// 発走前の取得ウィンドウ（分）: 各ウィンドウで ±3分
// オーケストレーターでも参照するため export
export const ODDS_WINDOWS = [60, 30, 15, 10, 5];

/**
 * 結果取得済みレースの race_id セットを取得（スキップ判定用）
 */
async function getFinishedRaceIds(date) {
  if (!isSupabaseEnabled()) return new Set();
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id")
    .like("race_id", `${date}%`)
    .not("payout_win", "is", null);
  if (error) {
    console.error("⚠️ 結果済みレースの確認に失敗:", error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.race_id));
}

/**
 * 単勝オッズページをスクレイプ
 * セレクタ: .oddsPoint（艇1〜6の順）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @returns {Array<number|null>} 艇1〜6の単勝オッズ（取得失敗は null）
 */
function scrapeWinOdds($) {
  const winOdds = [];
  $(".oddsPoint").each((i, el) => {
    if (i >= 6) return false;
    const text = $(el).text().trim();
    const val = parseFloat(text);
    // 0 以下は未公開・無効値として null に変換（有効な単勝オッズは必ず 1.0 以上）
    winOdds.push(!isNaN(val) && val > 0 ? val : null);
  });
  return winOdds;
}

/**
 * 3連単人気上位3つをスクレイプ
 * セレクタ: .is-p3-0 tbody tr（上位3行）
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @returns {Array<{combination: string|null, odds: number|null}>}
 */
function scrapeTrifectaOdds($) {
  const trifecta = [];
  $(".is-p3-0 tbody tr")
    .slice(0, 3)
    .each((i, row) => {
      const cells = $(row).find("td");
      const raw = $(cells[0]).text().trim();
      // "1-2-3" 形式に正規化（全角ハイフン・スペース等を半角に）
      const combination =
        raw.replace(/[－ー−]/g, "-").replace(/\s+/g, "") || null;
      const oddsText = $(cells[cells.length - 1])
        .text()
        .trim();
      const odds = parseFloat(oddsText);
      trifecta.push({
        combination,
        odds: isNaN(odds) ? null : odds,
      });
    });
  return trifecta;
}

/**
 * 1レースの単勝・3連単オッズを取得
 *
 * @param {string} date - YYYY-MM-DD
 * @param {number} venueCode - 会場コード (1-24)
 * @param {number} raceNo - レース番号 (1-12)
 * @returns {Promise<{winOdds: Array, trifecta: Array}|null>}
 */
async function fetchOddsForRace(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const winUrl = `https://www.boatrace.jp/owpc/pc/race/oddstf?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const trifUrl = `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  try {
    const [winRes, trifRes] = await Promise.all([
      fetch(winUrl, { headers: FETCH_HEADERS }),
      fetch(trifUrl, { headers: FETCH_HEADERS }),
    ]);

    if (!winRes.ok) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 単勝オッズ取得失敗 HTTP ${winRes.status}`,
      );
      return null;
    }

    const winOdds = scrapeWinOdds(cheerio.load(await winRes.text()));

    let trifecta = [];
    if (trifRes.ok) {
      trifecta = scrapeTrifectaOdds(cheerio.load(await trifRes.text()));
    }

    // 有効な単勝オッズが1件もなければ null
    if (!winOdds.some((o) => o !== null)) return null;

    return { winOdds, trifecta };
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R オッズ取得エラー: ${err.message}`,
    );
    return null;
  }
}

/**
 * オーケストレーターから呼び出し可能なオッズ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(schedule, date) {
  // 結果取得済みレースはスキップ
  const finishedIds = await getFinishedRaceIds(date);

  // 各ウィンドウで対象レースを収集（重複なし）
  const targetRaces = new Map();
  for (const minutes of ODDS_WINDOWS) {
    const inWindow = getRacesInWindow(schedule, minutes);
    for (const r of inWindow) {
      if (!finishedIds.has(r.race_id) && !targetRaces.has(r.race_id)) {
        targetRaces.set(r.race_id, r);
      }
    }
  }

  if (targetRaces.size === 0) {
    console.log("📭 オッズ: 取得対象レースなし（全ウィンドウ外）");
    return { updated: false, count: 0 };
  }

  console.log(
    `🎯 オッズ取得: ${targetRaces.size}レース (${ODDS_WINDOWS.map((m) => `${m}分前`).join("/")} ウィンドウ)`,
  );

  // 会場ごとにグループ化して並列取得
  const capturedAt = new Date().toISOString();
  const allRows = [];

  const byVenue = new Map();
  for (const r of targetRaces.values()) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchOddsForRace(date, r.venue_code, r.race_no).then((data) => ({
          r,
          data,
        })),
      ),
    );

    for (const { r, data } of results) {
      if (!data) continue;
      const { winOdds, trifecta } = data;

      allRows.push({
        race_id: r.race_id,
        captured_at: capturedAt,
        odds_win_1: winOdds[0] ?? null,
        odds_win_2: winOdds[1] ?? null,
        odds_win_3: winOdds[2] ?? null,
        odds_win_4: winOdds[3] ?? null,
        odds_win_5: winOdds[4] ?? null,
        odds_win_6: winOdds[5] ?? null,
        trifecta_popular_1: trifecta[0]?.combination ?? null,
        trifecta_odds_1: trifecta[0]?.odds ?? null,
        trifecta_popular_2: trifecta[1]?.combination ?? null,
        trifecta_odds_2: trifecta[1]?.odds ?? null,
        trifecta_popular_3: trifecta[2]?.combination ?? null,
        trifecta_odds_3: trifecta[2]?.odds ?? null,
      });

      const winStr = winOdds
        .map((o, i) => (o !== null ? `${i + 1}号艇:${o}` : null))
        .filter(Boolean)
        .join(", ");
      console.log(`  ✅ ${venueName} ${r.race_no}R — ${winStr}`);
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (allRows.length === 0) {
    console.log("\n📭 オッズ: 書き込みデータなし");
    return { updated: false, count: 0 };
  }

  console.log(`\n💾 race_odds: ${allRows.length}件書き込み中...`);
  for (let i = 0; i < allRows.length; i += 1000) {
    const batch = allRows.slice(i, i + 1000);
    const { error } = await supabase
      .from("race_odds")
      .upsert(batch, { onConflict: "race_id,captured_at" });
    if (error) {
      console.error("❌ race_odds 書き込みエラー:", error.message);
    }
  }

  console.log(`✅ race_odds: ${allRows.length}件完了`);
  return { updated: true, count: allRows.length };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🎰 オッズスクレイピング開始");
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

main().catch((err) => {
  console.error("❌ エラー:", err);
  process.exit(1);
});
