/**
 * 選手別統計集計スクリプト
 *
 * race_start_timings / race_results / race_entries から選手ごとの統計を算出し、
 * racer_aggregated_stats テーブルへ upsert する。
 *
 * 算出項目:
 *   - ST平均・直近30走ST平均・ST標準偏差・フライング率
 *   - 決まり手分布（コース別）
 *   - 進入コース傾向（枠番→コース分布）
 *
 * CLI:
 *   node scripts/analysis/aggregate-racer-stats.js [--racer=4203] [--all] [--venue=12] [--dry-run]
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { extractVenueCodeFromRaceId } from "../lib/dateUtils.js";
import { isPlaceHit } from "../lib/hitCalculator.js";
import {
  COURSE_DEFAULT_DISTRIBUTION,
  toTechniqueKey,
} from "../lib/winningTechniques.js";

// ===== CLI引数パース =====

function parseArgs() {
  const args = process.argv.slice(2);
  const racerArg = args.find((a) => a.startsWith("--racer="));
  const venueArg = args.find((a) => a.startsWith("--venue="));
  const allFlag = args.includes("--all");
  const dryRun = args.includes("--dry-run");

  return {
    racerId: racerArg ? parseInt(racerArg.split("=")[1], 10) : null,
    venueCode: venueArg ? parseInt(venueArg.split("=")[1], 10) : null,
    all: allFlag,
    dryRun,
  };
}

// ===== 統計ユーティリティ =====

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return null;
  const avg = mean(arr);
  const squareDiffs = arr.map((x) => Math.pow(x - avg, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

// ===== ST統計算出 =====

/**
 * 選手のST関連統計を算出
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { avg_st, avg_st_last_30, st_stddev, flying_rate, total_races }
 */
async function calculateRacerSTStats(racerId, venueCode = null) {
  // race_start_timings と race_entries を結合して選手のSTデータを取得
  // race_entries で racer_id -> (race_id, boat_number) を特定し、
  // race_start_timings で該当 race_id + boat_number の ST を取得

  // 1. race_entries から対象レースを取得
  let entriesQuery = supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId)
    .order("race_id", { ascending: false });

  const { data: entries, error: entriesError } = await entriesQuery;

  if (entriesError) {
    console.error(
      `  race_entries取得エラー (racer=${racerId}):`,
      entriesError.message,
    );
    return null;
  }

  if (!entries || entries.length === 0) {
    return null;
  }

  // 会場フィルタ
  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;

  if (filteredEntries.length === 0) {
    return null;
  }

  // 2. race_start_timings からSTデータをバッチ取得
  //    Supabase の .in() は大量データに制限があるため、チャンクに分割
  const CHUNK_SIZE = 200;
  const allTimings = [];

  for (let i = 0; i < filteredEntries.length; i += CHUNK_SIZE) {
    const chunk = filteredEntries.slice(i, i + CHUNK_SIZE);
    const raceIds = chunk.map((e) => e.race_id);

    const { data: timings, error: timingsError } = await supabase
      .from("race_start_timings")
      .select("race_id, boat_number, start_timing, is_flying, is_late_start")
      .in("race_id", raceIds);

    if (timingsError) {
      console.error(`  race_start_timings取得エラー:`, timingsError.message);
      continue;
    }

    if (timings) {
      allTimings.push(...timings);
    }
  }

  // 3. 選手の出走に対応するSTデータのみ抽出
  const entryMap = new Map();
  for (const entry of filteredEntries) {
    entryMap.set(`${entry.race_id}_${entry.boat_number}`, true);
  }

  const racerTimings = allTimings.filter((t) =>
    entryMap.has(`${t.race_id}_${t.boat_number}`),
  );

  if (racerTimings.length === 0) {
    return null;
  }

  // race_id降順でソート（新しい順）
  racerTimings.sort((a, b) => b.race_id.localeCompare(a.race_id));

  // 4. 統計算出
  const stValues = racerTimings
    .filter((t) => t.start_timing !== null && t.start_timing !== undefined)
    .map((t) => Number(t.start_timing));

  const stLast30 = stValues.slice(0, 30);

  const flyingCount = racerTimings.filter((t) => t.is_flying === true).length;
  const totalRaces = racerTimings.length;

  return {
    avg_st: stValues.length > 0 ? Number(mean(stValues).toFixed(3)) : null,
    avg_st_last_30:
      stLast30.length > 0 ? Number(mean(stLast30).toFixed(3)) : null,
    st_stddev:
      stValues.length >= 2 ? Number(stdDev(stValues).toFixed(3)) : null,
    flying_rate:
      totalRaces > 0 ? Number((flyingCount / totalRaces).toFixed(4)) : null,
    total_races: totalRaces,
  };
}

// ===== 決まり手分布算出 =====

/**
 * 選手の決まり手分布をコース別に算出
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "nige": 0.95, ... }, "2": { ... }, ... }
 */
async function calculateAttackDistribution(racerId, venueCode = null) {
  // 1. race_entries から対象レースの枠番を取得
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId);

  if (entriesError || !entries || entries.length === 0) {
    return null;
  }

  // 会場フィルタ
  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;

  if (filteredEntries.length === 0) {
    return null;
  }

  // 2. race_results を取得
  const CHUNK_SIZE = 200;
  const allResults = [];

  for (let i = 0; i < filteredEntries.length; i += CHUNK_SIZE) {
    const chunk = filteredEntries.slice(i, i + CHUNK_SIZE);
    const raceIds = chunk.map((e) => e.race_id);

    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, winning_technique, course_1, course_2, course_3, course_4, course_5, course_6",
      )
      .in("race_id", raceIds);

    if (resultsError) {
      console.error(`  race_results取得エラー:`, resultsError.message);
      continue;
    }

    if (results) {
      allResults.push(...results);
    }
  }

  // entryのマップ: race_id -> boat_number
  const entryBoatMap = new Map();
  for (const entry of filteredEntries) {
    entryBoatMap.set(entry.race_id, entry.boat_number);
  }

  // 3. 選手が1着になったレースのみ抽出し、コース別に決まり手を集計
  const courseWins = {}; // { course: { technique_key: count } }
  let totalWins = 0;

  for (const result of allResults) {
    const boatNumber = entryBoatMap.get(result.race_id);
    if (!boatNumber) continue;

    // この選手が1着かどうか
    if (result.rank1 !== boatNumber) continue;

    // course_1..course_6 から選手の枠番が何コースだったか特定
    let winCourse = null;
    for (let c = 1; c <= 6; c++) {
      if (result[`course_${c}`] === boatNumber) {
        winCourse = c;
        break;
      }
    }

    if (!winCourse) continue;

    // 決まり手を英語キーに変換
    const techKey = toTechniqueKey(result.winning_technique);
    if (!techKey) continue;

    if (!courseWins[winCourse]) {
      courseWins[winCourse] = {};
    }
    courseWins[winCourse][techKey] = (courseWins[winCourse][techKey] || 0) + 1;
    totalWins++;
  }

  // 4. データ不足の場合はデフォルト分布をフォールバック
  if (totalWins < 5) {
    return { ...COURSE_DEFAULT_DISTRIBUTION };
  }

  // 5. 各コースの割合を計算
  const distribution = {};
  for (const [course, techniques] of Object.entries(courseWins)) {
    const courseTotal = Object.values(techniques).reduce((a, b) => a + b, 0);
    distribution[course] = {};
    for (const [tech, count] of Object.entries(techniques)) {
      distribution[course][tech] = Number((count / courseTotal).toFixed(3));
    }
  }

  return distribution;
}

// ===== 被攻撃分布算出 =====

/**
 * 選手の被攻撃分布をコース別に算出
 * 「この選手がNコースにいた時、他の選手にどの決まり手で負けたか」
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "sashi": 0.30, "makuri": 0.25, ... }, "2": { ... } }
 */
async function calculateDefenseDistribution(racerId, venueCode = null) {
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId);

  if (entriesError || !entries || entries.length === 0) {
    return null;
  }

  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;

  if (filteredEntries.length === 0) {
    return null;
  }

  const CHUNK_SIZE = 200;
  const allResults = [];

  for (let i = 0; i < filteredEntries.length; i += CHUNK_SIZE) {
    const chunk = filteredEntries.slice(i, i + CHUNK_SIZE);
    const raceIds = chunk.map((e) => e.race_id);

    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, winning_technique, course_1, course_2, course_3, course_4, course_5, course_6",
      )
      .in("race_id", raceIds);

    if (resultsError) {
      console.error(`  race_results取得エラー:`, resultsError.message);
      continue;
    }

    if (results) {
      allResults.push(...results);
    }
  }

  const entryBoatMap = new Map();
  for (const entry of filteredEntries) {
    entryBoatMap.set(entry.race_id, entry.boat_number);
  }

  // 選手が1着でないレースを対象に、勝者の決まり手をコース別に集計
  const courseLosses = {}; // { course: { technique_key: count } }

  for (const result of allResults) {
    const boatNumber = entryBoatMap.get(result.race_id);
    if (!boatNumber) continue;

    // この選手が1着なら被攻撃なし
    if (result.rank1 === boatNumber) continue;

    // 決まり手がない場合はスキップ
    const techKey = toTechniqueKey(result.winning_technique);
    if (!techKey) continue;

    // この選手が何コースにいたか特定
    let myCourse = null;
    for (let c = 1; c <= 6; c++) {
      if (result[`course_${c}`] === boatNumber) {
        myCourse = c;
        break;
      }
    }

    if (!myCourse) continue;

    if (!courseLosses[myCourse]) {
      courseLosses[myCourse] = {};
    }
    courseLosses[myCourse][techKey] =
      (courseLosses[myCourse][techKey] || 0) + 1;
  }

  // データ不足の場合はnullを返す（デフォルト分布はcaller側で処理）
  const totalLosses = Object.values(courseLosses).reduce(
    (sum, techs) => sum + Object.values(techs).reduce((a, b) => a + b, 0),
    0,
  );

  if (totalLosses < 5) {
    return null;
  }

  // 各コースの割合を計算
  const distribution = {};
  for (const [course, techniques] of Object.entries(courseLosses)) {
    const courseTotal = Object.values(techniques).reduce((a, b) => a + b, 0);
    distribution[course] = {};
    for (const [tech, count] of Object.entries(techniques)) {
      distribution[course][tech] = Number((count / courseTotal).toFixed(3));
    }
  }

  return distribution;
}

// ===== コース別出走数算出 =====

/**
 * 選手のコース別出走数・勝数を算出
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "total": 50, "wins": 28, "top2": 35, "top3": 40 }, "2": { ... } }
 */
async function calculateCourseRaceCounts(racerId, venueCode = null) {
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId);

  if (entriesError || !entries || entries.length === 0) {
    return null;
  }

  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;

  if (filteredEntries.length === 0) {
    return null;
  }

  const CHUNK_SIZE = 200;
  const allResults = [];

  for (let i = 0; i < filteredEntries.length; i += CHUNK_SIZE) {
    const chunk = filteredEntries.slice(i, i + CHUNK_SIZE);
    const raceIds = chunk.map((e) => e.race_id);

    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, course_1, course_2, course_3, course_4, course_5, course_6",
      )
      .in("race_id", raceIds);

    if (resultsError) {
      console.error(`  race_results取得エラー:`, resultsError.message);
      continue;
    }

    if (results) {
      allResults.push(...results);
    }
  }

  const entryBoatMap = new Map();
  for (const entry of filteredEntries) {
    entryBoatMap.set(entry.race_id, entry.boat_number);
  }

  const resultsMap = new Map();
  for (const r of allResults) {
    resultsMap.set(r.race_id, r);
  }

  const courseCounts = {}; // { course: { total: N, wins: N } }

  for (const entry of filteredEntries) {
    const result = resultsMap.get(entry.race_id);
    if (!result) continue;

    const boatNumber = entry.boat_number;

    let actualCourse = null;
    for (let c = 1; c <= 6; c++) {
      if (result[`course_${c}`] === boatNumber) {
        actualCourse = c;
        break;
      }
    }

    if (!actualCourse) continue;

    const courseKey = String(actualCourse);
    if (!courseCounts[courseKey]) {
      courseCounts[courseKey] = { total: 0, wins: 0, top2: 0, top3: 0 };
    }
    courseCounts[courseKey].total++;

    if (result.rank1 === boatNumber) {
      courseCounts[courseKey].wins++;
    }
    if (isPlaceHit(boatNumber, result.rank1, result.rank2)) {
      courseCounts[courseKey].top2++;
    }
    if (
      isPlaceHit(boatNumber, result.rank1, result.rank2) ||
      result.rank3 === boatNumber
    ) {
      courseCounts[courseKey].top3++;
    }
  }

  return Object.keys(courseCounts).length > 0 ? courseCounts : null;
}

// ===== 進入コース傾向算出 =====

/**
 * 選手の進入コース傾向を算出（枠番→実際のコース分布）
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "1": 0.90, "2": 0.05, ... }, "2": { ... }, ... }
 */
async function calculateCourseEntryTendency(racerId, venueCode = null) {
  // 1. race_entries から対象レースの枠番を取得
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId);

  if (entriesError || !entries || entries.length === 0) {
    return null;
  }

  // 会場フィルタ
  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;

  if (filteredEntries.length === 0) {
    return null;
  }

  // 2. race_results を取得（course_1..course_6）
  const CHUNK_SIZE = 200;
  const allResults = [];

  for (let i = 0; i < filteredEntries.length; i += CHUNK_SIZE) {
    const chunk = filteredEntries.slice(i, i + CHUNK_SIZE);
    const raceIds = chunk.map((e) => e.race_id);

    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select(
        "race_id, course_1, course_2, course_3, course_4, course_5, course_6",
      )
      .in("race_id", raceIds);

    if (resultsError) {
      console.error(`  race_results取得エラー:`, resultsError.message);
      continue;
    }

    if (results) {
      allResults.push(...results);
    }
  }

  // resultsマップ: race_id -> result
  const resultsMap = new Map();
  for (const r of allResults) {
    resultsMap.set(r.race_id, r);
  }

  // 3. 枠番ごとに実際のコース分布を集計
  const boatCourseCount = {}; // { boat_number: { course: count } }

  for (const entry of filteredEntries) {
    const result = resultsMap.get(entry.race_id);
    if (!result) continue;

    const boatNumber = entry.boat_number;

    // course_1..course_6 から、この枠番が何コースに入ったか特定
    let actualCourse = null;
    for (let c = 1; c <= 6; c++) {
      if (result[`course_${c}`] === boatNumber) {
        actualCourse = c;
        break;
      }
    }

    if (!actualCourse) continue;

    const boatKey = String(boatNumber);
    if (!boatCourseCount[boatKey]) {
      boatCourseCount[boatKey] = {};
    }
    boatCourseCount[boatKey][actualCourse] =
      (boatCourseCount[boatKey][actualCourse] || 0) + 1;
  }

  // 4. 割合に変換
  const tendency = {};
  for (const [boat, courses] of Object.entries(boatCourseCount)) {
    const total = Object.values(courses).reduce((a, b) => a + b, 0);
    tendency[boat] = {};
    for (const [course, count] of Object.entries(courses)) {
      tendency[boat][course] = Number((count / total).toFixed(3));
    }
  }

  return tendency;
}

// ===== 選手1人分の集計 =====

/**
 * 選手1人分の統計を集計する
 * @param {number} racerId - 選手登録番号
 * @param {number} venueCode - 会場コード（0=全会場）
 * @returns {Object|null} upsert用データ
 */
async function aggregateRacer(racerId, venueCode = 0) {
  const filterVenue = venueCode > 0 ? venueCode : null;

  const [stStats, attackDist, defenseDist, courseTendency, courseRaceCounts] =
    await Promise.all([
      calculateRacerSTStats(racerId, filterVenue),
      calculateAttackDistribution(racerId, filterVenue),
      calculateDefenseDistribution(racerId, filterVenue),
      calculateCourseEntryTendency(racerId, filterVenue),
      calculateCourseRaceCounts(racerId, filterVenue),
    ]);

  // STデータがなくても攻撃/防御分布があれば保存する
  if (!stStats && !attackDist && !defenseDist && !courseRaceCounts) {
    return null;
  }

  return {
    racer_id: racerId,
    venue_code: venueCode,
    avg_st: stStats?.avg_st ?? null,
    avg_st_last_30: stStats?.avg_st_last_30 ?? null,
    st_stddev: stStats?.st_stddev ?? null,
    flying_rate: stStats?.flying_rate ?? null,
    attack_distribution: attackDist || { ...COURSE_DEFAULT_DISTRIBUTION },
    defense_distribution: defenseDist || {},
    course_entry_tendency: courseTendency || null,
    course_race_counts: courseRaceCounts || {},
    total_races: stStats?.total_races ?? 0,
    calculated_at: new Date().toISOString(),
  };
}

// ===== upsert =====

async function upsertRacerStats(record, dryRun = false) {
  if (dryRun) {
    return true;
  }

  const { error } = await supabase
    .from("racer_aggregated_stats")
    .upsert(record, { onConflict: "racer_id,venue_code" });

  if (error) {
    console.error(
      `  upsertエラー (racer=${record.racer_id}, venue=${record.venue_code}):`,
      error.message,
    );
    return false;
  }

  return true;
}

// ===== 結果表示 =====

function printRacerStats(record) {
  console.log(
    `\n  選手: ${record.racer_id} (会場: ${record.venue_code === 0 ? "全会場" : record.venue_code})`,
  );
  console.log(`  総レース数: ${record.total_races}`);
  console.log(
    `  平均ST: ${record.avg_st ?? "-"}  直近30走ST: ${record.avg_st_last_30 ?? "-"}  ST標準偏差: ${record.st_stddev ?? "-"}`,
  );
  console.log(
    `  フライング率: ${record.flying_rate !== null ? (record.flying_rate * 100).toFixed(2) + "%" : "-"}`,
  );

  if (record.attack_distribution) {
    console.log(`  決まり手分布:`);
    for (const [course, techs] of Object.entries(record.attack_distribution)) {
      const techStr = Object.entries(techs)
        .sort((a, b) => b[1] - a[1])
        .map(([t, v]) => `${t}:${(v * 100).toFixed(1)}%`)
        .join(", ");
      console.log(`    ${course}コース: ${techStr}`);
    }
  }

  if (
    record.defense_distribution &&
    Object.keys(record.defense_distribution).length > 0
  ) {
    console.log(`  被攻撃分布:`);
    for (const [course, techs] of Object.entries(record.defense_distribution)) {
      const techStr = Object.entries(techs)
        .sort((a, b) => b[1] - a[1])
        .map(([t, v]) => `${t}:${(v * 100).toFixed(1)}%`)
        .join(", ");
      console.log(`    ${course}コース: ${techStr}`);
    }
  }

  if (
    record.course_race_counts &&
    Object.keys(record.course_race_counts).length > 0
  ) {
    console.log(`  コース別出走数:`);
    for (const [course, counts] of Object.entries(record.course_race_counts)) {
      const rate = (n) =>
        counts.total > 0 ? ((n / counts.total) * 100).toFixed(1) : "0.0";
      console.log(
        `    ${course}コース: ${counts.total}走 ${counts.wins}勝 (勝率${rate(counts.wins)}% 2連率${rate(counts.top2 ?? 0)}% 3連率${rate(counts.top3 ?? 0)}%)`,
      );
    }
  }

  if (record.course_entry_tendency) {
    console.log(`  進入コース傾向:`);
    for (const [boat, courses] of Object.entries(
      record.course_entry_tendency,
    )) {
      const courseStr = Object.entries(courses)
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `${c}コース:${(v * 100).toFixed(1)}%`)
        .join(", ");
      console.log(`    ${boat}号艇: ${courseStr}`);
    }
  }
}

// ===== 全選手取得 =====

async function getAllRacerIds() {
  console.log("  全選手IDを取得中...");

  // race_entries から重複なしの racer_id を取得
  // Supabase JS クライアントで DISTINCT は直接使えないため、
  // ページネーションで全データ取得し、Setで重複排除
  const racerIds = new Set();
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("race_entries")
      .select("racer_id")
      .range(offset, offset + PAGE_SIZE - 1)
      .order("racer_id", { ascending: true });

    if (error) {
      console.error("  race_entries取得エラー:", error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      racerIds.add(row.racer_id);
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`  ${racerIds.size}人の選手を検出`);
  return [...racerIds].sort((a, b) => a - b);
}

// ===== メイン処理 =====

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase環境変数が未設定です");
    process.exit(1);
  }

  const { racerId, venueCode, all, dryRun } = parseArgs();

  if (!racerId && !all) {
    console.log("使い方:");
    console.log(
      "  node scripts/analysis/aggregate-racer-stats.js --racer=4203",
    );
    console.log(
      "  node scripts/analysis/aggregate-racer-stats.js --racer=4203 --venue=12",
    );
    console.log("  node scripts/analysis/aggregate-racer-stats.js --all");
    console.log(
      "  node scripts/analysis/aggregate-racer-stats.js --all --venue=12",
    );
    console.log(
      "  node scripts/analysis/aggregate-racer-stats.js --all --dry-run",
    );
    process.exit(0);
  }

  if (dryRun) {
    console.log("[dry-run] DBへの書き込みはスキップされます\n");
  }

  // --- 単一選手モード ---
  if (racerId && !all) {
    console.log(`選手 ${racerId} の統計を集計中...`);

    // 全会場の統計
    const record = await aggregateRacer(racerId, 0);
    if (record) {
      printRacerStats(record);
      const ok = await upsertRacerStats(record, dryRun);
      if (ok && !dryRun)
        console.log("  -> racer_aggregated_stats に保存しました");
    } else {
      console.log(`  選手 ${racerId} のデータが見つかりません`);
    }

    // 会場指定がある場合は会場別統計も算出
    if (venueCode) {
      const venueRecord = await aggregateRacer(racerId, venueCode);
      if (venueRecord) {
        printRacerStats(venueRecord);
        const ok = await upsertRacerStats(venueRecord, dryRun);
        if (ok && !dryRun)
          console.log("  -> racer_aggregated_stats に保存しました");
      } else {
        console.log(
          `  選手 ${racerId} の会場${venueCode}データが見つかりません`,
        );
      }
    }

    return;
  }

  // --- 全選手モード ---
  if (all) {
    console.log("全選手の統計集計を開始します...\n");

    const racerIds = await getAllRacerIds();
    let processed = 0;
    let succeeded = 0;
    let skipped = 0;
    const startTime = Date.now();

    for (const id of racerIds) {
      processed++;

      // 進捗表示（50人ごと）
      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((processed / (Date.now() - startTime)) * 1000).toFixed(1);
        console.log(
          `  進捗: ${processed}/${racerIds.length} (${((processed / racerIds.length) * 100).toFixed(1)}%) - ${elapsed}秒経過 - ${rate}人/秒`,
        );
      }

      // 全会場統計
      const record = await aggregateRacer(id, 0);
      if (!record) {
        skipped++;
        continue;
      }

      const ok = await upsertRacerStats(record, dryRun);
      if (ok) succeeded++;

      // 会場指定がある場合は会場別統計も算出
      if (venueCode) {
        const venueRecord = await aggregateRacer(id, venueCode);
        if (venueRecord) {
          await upsertRacerStats(venueRecord, dryRun);
        }
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n集計完了:`);
    console.log(`  処理: ${processed}人`);
    console.log(`  成功: ${succeeded}人`);
    console.log(`  スキップ: ${skipped}人 (データ不足)`);
    console.log(`  所要時間: ${totalTime}秒`);
    if (dryRun) {
      console.log("  [dry-run] DB書き込みはスキップされました");
    }
  }
}

main().catch((err) => {
  console.error("実行エラー:", err);
  process.exit(1);
});
