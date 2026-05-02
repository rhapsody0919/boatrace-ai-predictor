/**
 * レース情報リアルタイム更新スクリプト
 *
 * 発走1時間前のウィンドウで racelist・beforeinfo をスクレイプし、
 * 出場選手情報・天候データを Supabase に更新する。
 * 欠場・代替選手・レース中止の検出もここで行う。
 *
 * scrape-scheduled.yml から5分毎に実行される（1時間前ウィンドウのレースのみ対象）。
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

// 発走1時間前ウィンドウ（±3分）
const WINDOW_MINUTES = 60;

const WIND_DIRECTIONS = [
  null,
  "北",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
];

function convertWindDirection(dir) {
  if (dir == null || dir < 1 || dir > 16) return null;
  return WIND_DIRECTIONS[dir];
}

/**
 * racelist ページから出場選手情報を取得
 *
 * @param {CheerioAPI} $ - cheerio インスタンス
 * @returns {Array<Object>} 選手情報（1〜6号艇）
 */
function scrapeRacers($) {
  const racers = [];
  $(".table1 tbody.is-fs12").each((index, tbody) => {
    if (index >= 6) return false;
    const $tbody = $(tbody);

    const name = $tbody.find(".is-fs18.is-fBold a").text().trim();
    const $fs11Divs = $tbody.find(".is-fs11");

    const gradeText = $fs11Divs.eq(0).text().trim();
    const racerIdMatch = gradeText.match(/^(\d+)/);
    const racerId = racerIdMatch ? parseInt(racerIdMatch[1]) : null;
    const gradeMatch = gradeText.match(/\s*\/\s*([AB][12])/);
    const grade = gradeMatch ? gradeMatch[1] : null;

    const ageText = $fs11Divs.eq(1).text().trim();
    const ageMatch = ageText.match(/(\d+)歳/);
    const age = ageMatch ? parseInt(ageMatch[1]) : null;

    const $stats = $tbody.find("td.is-lineH2");

    const globalStats = $stats
      .eq(1)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const localStats = $stats
      .eq(2)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const motorStats = $stats
      .eq(3)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const boatStats = $stats
      .eq(4)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const toFloat = (s) => { const v = parseFloat(s); return isNaN(v) ? null : v; };
    const toInt = (s) => { const v = parseInt(s, 10); return isNaN(v) ? null : v; };

    racers.push({
      boatNumber: index + 1,
      racerId,
      playerName: name || null,
      grade,
      age,
      winRate: toFloat(globalStats[0]),
      localWinRate: toFloat(localStats[0]),
      global2Rate: toFloat(globalStats[1]),
      local2Rate: toFloat(localStats[1]),
      global3Rate: toFloat(globalStats[2]),
      local3Rate: toFloat(localStats[2]),
      motorNumber: toInt(motorStats[0]),
      motor2Rate: toFloat(motorStats[1]),
      motor3Rate: toFloat(motorStats[2]),
      boatNumberId: toInt(boatStats[0]),
      boat2Rate: toFloat(boatStats[1]),
      boat3Rate: toFloat(boatStats[2]),
    });
  });
  return racers;
}

/**
 * racelist ページからレースグレード・タイトルを取得
 */
function scrapeRaceMeta($) {
  const raceGrade = (() => {
    const el = $(".heading2_title");
    if (!el.length) return null;
    const cls = (el.attr("class") || "").toLowerCase();
    if (cls.includes("is-sg")) return "SG";
    if (cls.includes("is-g1")) return "G1";
    if (cls.includes("is-g2")) return "G2";
    if (cls.includes("is-g3")) return "G3";
    return "ippan";
  })();
  const raceTitle = $(".heading2_titleName").text().trim() || null;
  return { raceGrade, raceTitle };
}

/**
 * beforeinfo ページから天候情報を取得
 */
function scrapeConditions($) {
  const weatherData = [];
  $(".weather1_bodyUnitLabelData").each((i, el) => {
    weatherData.push($(el).text().trim());
  });

  let weather = null;
  $(".weather1_bodyUnitLabelTitle").each((i, el) => {
    if (i === 1) weather = $(el).text().trim();
  });

  let windDirection = null;
  const windElem = $('p[class*="is-wind"]');
  if (windElem.length > 0) {
    const windClass = (windElem.attr("class") || "")
      .split(" ")
      .find((c) => c.startsWith("is-wind"));
    if (windClass) windDirection = parseInt(windClass.replace("is-wind", ""));
  }

  return {
    weather: weather || null,
    airTemp: weatherData[0]
      ? parseFloat(weatherData[0].replace("℃", ""))
      : null,
    windDirection,
    windVelocity: weatherData[1]
      ? parseFloat(weatherData[1].replace("m", ""))
      : null,
    waterTemp: weatherData[2]
      ? parseFloat(weatherData[2].replace("℃", ""))
      : null,
    waveHeight: weatherData[3]
      ? parseFloat(weatherData[3].replace("cm", ""))
      : null,
  };
}

/**
 * 1レースの racelist + beforeinfo を並列取得
 */
async function fetchRaceInfo(date, venueCode, raceNo) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const racelistUrl = `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  const beforeinfoUrl = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;

  try {
    const [racelistRes, beforeinfoRes] = await Promise.all([
      fetch(racelistUrl, { headers: FETCH_HEADERS }),
      fetch(beforeinfoUrl, { headers: FETCH_HEADERS }),
    ]);

    if (!racelistRes.ok) {
      console.error(
        `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R racelist 取得失敗 HTTP ${racelistRes.status}`,
      );
      return null;
    }

    const $racelist = cheerio.load(await racelistRes.text());
    const racers = scrapeRacers($racelist);
    const { raceGrade, raceTitle } = scrapeRaceMeta($racelist);

    // 選手が1人も取得できない場合は中止・未公開の可能性
    if (racers.length === 0) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 選手情報なし（中止・未公開の可能性）`,
      );
      return null;
    }

    // 欠場検出: racerId が null の艇がいる場合
    const absentBoats = racers
      .filter((r) => r.racerId === null)
      .map((r) => r.boatNumber);
    if (absentBoats.length > 0) {
      console.warn(
        `  ⚠️ ${VENUE_NAMES[venueCode]} ${raceNo}R 欠場/代替の可能性: ${absentBoats.map((b) => `${b}号艇`).join(", ")}`,
      );
    }

    let conditions = null;
    if (beforeinfoRes.ok) {
      conditions = scrapeConditions(cheerio.load(await beforeinfoRes.text()));
    }

    return { racers, raceGrade, raceTitle, conditions };
  } catch (err) {
    console.error(
      `  ❌ ${VENUE_NAMES[venueCode]} ${raceNo}R 取得エラー: ${err.message}`,
    );
    return null;
  }
}

/**
 * オーケストレーターから呼び出し可能なレース情報更新処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(schedule, date) {
  // 発走1時間前ウィンドウのレースのみ対象
  const targetRaces = getRacesInWindow(schedule, WINDOW_MINUTES);
  if (targetRaces.length === 0) {
    console.log(`📭 レース情報: 発走${WINDOW_MINUTES}分前ウィンドウの対象レースなし`);
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 レース情報更新: ${targetRaces.length}レース（発走${WINDOW_MINUTES}分前ウィンドウ）`,
  );

  // 会場ごとにグループ化して並列取得
  const entriesRows = [];
  const conditionsRows = [];

  const byVenue = new Map();
  for (const r of targetRaces) {
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
        fetchRaceInfo(date, r.venue_code, r.race_no).then((data) => ({
          r,
          data,
        })),
      ),
    );

    for (const { r, data } of results) {
      if (!data) continue;
      const { racers, raceGrade, raceTitle, conditions } = data;

      // race_entries 行を構築（ai_score系は更新しない）
      for (const racer of racers) {
        entriesRows.push({
          race_id: r.race_id,
          boat_number: racer.boatNumber,
          racer_id: racer.racerId,
          player_name: racer.playerName,
          grade: racer.grade,
          age: racer.age,
          win_rate: racer.winRate,
          local_win_rate: racer.localWinRate,
          global_2rate: racer.global2Rate,
          local_2rate: racer.local2Rate,
          global_3rate: racer.global3Rate,
          local_3rate: racer.local3Rate,
          motor_number: racer.motorNumber,
          motor_2rate: racer.motor2Rate,
          motor_3rate: racer.motor3Rate,
          boat_number_id: racer.boatNumberId,
          boat_2rate: racer.boat2Rate,
          boat_3rate: racer.boat3Rate,
        });
      }

      // race_conditions 行を構築
      if (conditions || raceGrade) {
        conditionsRows.push({
          race_id: r.race_id,
          weather: conditions?.weather ?? null,
          wind_direction: convertWindDirection(
            conditions?.windDirection ?? null,
          ),
          wind_speed: conditions?.windVelocity ?? null,
          wave_height:
            conditions?.waveHeight != null
              ? Math.round(conditions.waveHeight)
              : null,
          temperature: conditions?.airTemp ?? null,
          water_temperature: conditions?.waterTemp ?? null,
          race_grade: raceGrade,
          race_title: raceTitle,
        });
      }

      const racerSummary = racers
        .map(
          (r) =>
            `${r.boatNumber}号艇:${r.playerName ?? "不明"}(${r.grade ?? "??"})`,
        )
        .join(", ");
      console.log(`  ✅ ${venueName} ${r.race_no}R — ${racerSummary}`);
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (entriesRows.length === 0) {
    console.log("\n📭 レース情報: 書き込みデータなし");
    return { updated: false, count: 0 };
  }

  console.log(`\n💾 レース情報書き込み中...`);

  // race_entries upsert
  for (let i = 0; i < entriesRows.length; i += 1000) {
    const batch = entriesRows.slice(i, i + 1000);
    const { error } = await supabase
      .from("race_entries")
      .upsert(batch, { onConflict: "race_id,boat_number" });
    if (error) console.error("❌ race_entries 書き込みエラー:", error.message);
  }
  console.log(`  ✅ race_entries: ${entriesRows.length}件`);

  // race_conditions upsert
  if (conditionsRows.length > 0) {
    const { error } = await supabase
      .from("race_conditions")
      .upsert(conditionsRows, { onConflict: "race_id" });
    if (error)
      console.error("❌ race_conditions 書き込みエラー:", error.message);
    else console.log(`  ✅ race_conditions: ${conditionsRows.length}件`);
  }

  return { updated: true, count: entriesRows.length };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("📋 レース情報更新開始");
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
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
