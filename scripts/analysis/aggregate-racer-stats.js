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
import {
  extractVenueCodeFromRaceId,
  getDateDaysAgo,
} from "../lib/dateUtils.js";
import {
  ACTUAL_COURSE_SELECT,
  buildCourseEntryTendency,
} from "../lib/courseEntryTendency.js";
import { isPlaceHit, isShowHit } from "../lib/hitCalculator.js";
import {
  COURSE_DEFAULT_DISTRIBUTION,
  toTechniqueKey,
} from "../lib/winningTechniques.js";
import {
  computeRacerStStats,
  fetchRacerEntries,
  fetchStartTimingsForEntries,
} from "../lib/racerStStats.js";
import { fetchAll } from "../lib/supabaseClient.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { isNoRaceResult, placedRanks } from "../lib/raceOutcomeFilters.js";
import { isDirectRun } from "../lib/isDirectRun.js";

// ===== 取得（ページング＋例外。BOA-581 と同じ作り、BOA-600） =====

const RESULTS_CHUNK_SIZE = 200;

/**
 * 選手の出走（race_entries）を全件取り、会場・期間で絞る。
 * 以前は4つの集計関数がそれぞれ .range() 無しで取り、取得エラーは null（＝データなし）に
 * していた。1000行の上限で黙って切れる・一時的なエラーで分布が空のまま保存される、の2つを
 * 防ぐため、fetchRacerEntries（ページング・例外）に揃える
 * @param {number} racerId
 * @param {number|null} venueCode
 * @param {string|null} since YYYY-MM-DD。指定すればそれ以降の race_id だけ
 */
async function fetchFilteredEntries(racerId, venueCode, since = null) {
  const entries = await fetchRacerEntries(supabase, racerId);
  return entries.filter(
    (e) =>
      (!venueCode || extractVenueCodeFromRaceId(e.race_id) === venueCode) &&
      (!since || e.race_id >= since),
  );
}

/**
 * race_results を race_id の集合で取る。取得エラーは例外にする（以前は continue で
 * そのチャンクを飛ばし、一部のレースだけで集計した値を保存していた。BOA-600）
 */
async function fetchResultsForEntries(entries, select) {
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const all = [];
  for (let i = 0; i < raceIds.length; i += RESULTS_CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + RESULTS_CHUNK_SIZE);
    const rows = await fetchAll(
      "race_results",
      select,
      (q) => q.in("race_id", chunk).order("race_id", { ascending: true }),
      { throwOnError: true, client: supabase },
    );
    all.push(...rows);
  }
  return all;
}

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

// ===== ST統計算出 =====

/**
 * 選手のST関連統計を算出（定義は scripts/lib/racerStStats.js）
 * 取得エラーは例外にする（黙って一部のデータで集計しない。BOA-581）
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Promise<Object|null>} { avg_st, avg_st_last_30, st_stddev, flying_rate, total_races }
 */
async function calculateRacerSTStats(racerId, venueCode = null) {
  const entries = await fetchRacerEntries(supabase, racerId);
  const filteredEntries = venueCode
    ? entries.filter((e) => extractVenueCodeFromRaceId(e.race_id) === venueCode)
    : entries;
  if (filteredEntries.length === 0) return null;

  const timings = await fetchStartTimingsForEntries(supabase, filteredEntries);
  return computeRacerStStats(filteredEntries, timings);
}

// ===== 決まり手分布算出 =====

/** 艇番 boatNumber が1〜6コースのどこに入ったか（course_1..6 から特定）。見つからなければ null */
function findCourseOfBoat(result, boatNumber) {
  for (let c = 1; c <= 6; c++) {
    if (result[`course_${c}`] === boatNumber) return c;
  }
  return null;
}

/** 選手の出走（race_id -> boat_number） */
function buildEntryBoatMap(entries) {
  const entryBoatMap = new Map();
  for (const entry of entries) {
    entryBoatMap.set(entry.race_id, entry.boat_number);
  }
  return entryBoatMap;
}

/**
 * 決まり手・被攻撃の集計（{ course: { technique_key: count } }）を、コースごとの割合
 * （小数3桁）にする
 */
function toCourseRatios(courseCounts) {
  const distribution = {};
  for (const [course, techniques] of Object.entries(courseCounts)) {
    const courseTotal = Object.values(techniques).reduce((a, b) => a + b, 0);
    distribution[course] = {};
    for (const [tech, count] of Object.entries(techniques)) {
      distribution[course][tech] = Number((count / courseTotal).toFixed(3));
    }
  }
  return distribution;
}

/**
 * 選手の出走と、その race_results（selectの列）を取る。出走が無ければ null
 * @param {string|null} since YYYY-MM-DD。指定すればそれ以降の race_id だけ
 */
async function fetchEntriesAndResults(racerId, venueCode, since, select) {
  const filteredEntries = await fetchFilteredEntries(racerId, venueCode, since);

  if (filteredEntries.length === 0) {
    return null;
  }

  const allResults = await fetchResultsForEntries(filteredEntries, select);
  return { filteredEntries, allResults };
}

const DECISIVE_RESULT_SELECT =
  "race_id, rank1, winning_technique, course_1, course_2, course_3, course_4, course_5, course_6";

/** 選手が1着になったレースのみ抽出し、コース別に決まり手を集計 */
function tallyWinTechniques(allResults, entryBoatMap) {
  const courseWins = {}; // { course: { technique_key: count } }
  let totalWins = 0;

  for (const result of allResults) {
    const boatNumber = entryBoatMap.get(result.race_id);
    if (!boatNumber) continue;

    // この選手が1着かどうか
    if (result.rank1 !== boatNumber) continue;

    // course_1..course_6 から選手の枠番が何コースだったか特定
    const winCourse = findCourseOfBoat(result, boatNumber);

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

  return { courseWins, totalWins };
}

/**
 * 選手の決まり手分布をコース別に算出
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "nige": 0.95, ... }, "2": { ... }, ... }
 */
async function calculateAttackDistribution(racerId, venueCode = null) {
  // 1. 出走と race_results を取得
  const fetched = await fetchEntriesAndResults(
    racerId,
    venueCode,
    null,
    DECISIVE_RESULT_SELECT,
  );
  if (!fetched) return null;

  // 2. 選手が1着になったレースのみ抽出し、コース別に決まり手を集計
  const { courseWins, totalWins } = tallyWinTechniques(
    fetched.allResults,
    buildEntryBoatMap(fetched.filteredEntries),
  );

  // 3. データ不足の場合はデフォルト分布をフォールバック
  if (totalWins < 5) {
    return { ...COURSE_DEFAULT_DISTRIBUTION };
  }

  // 4. 各コースの割合を計算
  return toCourseRatios(courseWins);
}

// ===== 被攻撃分布算出 =====

/** 選手が1着でないレースを対象に、勝者の決まり手をコース別に集計 */
function tallyLossTechniques(allResults, entryBoatMap) {
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
    const myCourse = findCourseOfBoat(result, boatNumber);

    if (!myCourse) continue;

    if (!courseLosses[myCourse]) {
      courseLosses[myCourse] = {};
    }
    courseLosses[myCourse][techKey] =
      (courseLosses[myCourse][techKey] || 0) + 1;
  }

  return courseLosses;
}

/**
 * 選手の被攻撃分布をコース別に算出
 * 「この選手がNコースにいた時、他の選手にどの決まり手で負けたか」
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "sashi": 0.30, "makuri": 0.25, ... }, "2": { ... } }
 */
async function calculateDefenseDistribution(racerId, venueCode = null) {
  const fetched = await fetchEntriesAndResults(
    racerId,
    venueCode,
    null,
    DECISIVE_RESULT_SELECT,
  );
  if (!fetched) return null;

  // 選手が1着でないレースを対象に、勝者の決まり手をコース別に集計
  const courseLosses = tallyLossTechniques(
    fetched.allResults,
    buildEntryBoatMap(fetched.filteredEntries),
  );

  // データ不足の場合はnullを返す（デフォルト分布はcaller側で処理）
  const totalLosses = Object.values(courseLosses).reduce(
    (sum, techs) => sum + Object.values(techs).reduce((a, b) => a + b, 0),
    0,
  );

  if (totalLosses < 5) {
    return null;
  }

  // 各コースの割合を計算
  return toCourseRatios(courseLosses);
}

// ===== コース別出走数算出 =====

// 枠番別の出走数・勝数（course_race_counts）の期間（BOA-824、2026-10-10 ユーザー選択の案1）。
// データ出走表の「枠番勝率（直近1年）」と、予想バッチ（1マーク展開予測・AIのスコア）の入力を兼ねる。
// 以前は期間で絞らない全期間（DB は 2025-12-02 から）で、データ出走表の注記「過去90日間」とも食い違っていた。
// DB が1年分たまる 2026-12-02 までは値が変わらない
const COURSE_RACE_COUNTS_WINDOW_DAYS = 365;

const COURSE_RACE_COUNTS_SELECT =
  "race_id, rank1, rank2, rank3, is_cancelled, race_status, refund_boats, course_1, course_2, course_3, course_4, course_5, course_6";

/** 出走ごとに、実際に入ったコース別の出走数・勝数・2連対・3連対を数える */
function tallyCourseRaceCounts(filteredEntries, resultsMap) {
  const courseCounts = {}; // { course: { total: N, wins: N } }

  for (const entry of filteredEntries) {
    const result = resultsMap.get(entry.race_id);
    if (
      !result ||
      result.is_cancelled ||
      isNoRaceResult(result) ||
      result.rank1 === null
    ) {
      continue;
    }

    const boatNumber = entry.boat_number;

    const actualCourse = findCourseOfBoat(result, boatNumber);

    if (!actualCourse) continue;

    const courseKey = String(actualCourse);
    if (!courseCounts[courseKey]) {
      courseCounts[courseKey] = { total: 0, wins: 0, top2: 0, top3: 0 };
    }
    courseCounts[courseKey].total++;

    if (result.rank1 === boatNumber) {
      courseCounts[courseKey].wins++;
    }
    // 完走3艇未満のレースは、返還艇が表の行順で2着・3着に入っている。2連対・3連対に数えない（BOA-579）
    const placed = placedRanks(result);
    if (isPlaceHit(boatNumber, placed.rank1, placed.rank2)) {
      courseCounts[courseKey].top2++;
    }
    if (isShowHit(boatNumber, placed.rank1, placed.rank2, placed.rank3)) {
      courseCounts[courseKey].top3++;
    }
  }

  return courseCounts;
}

/**
 * 選手のコース別出走数・勝数を算出（直近 COURSE_RACE_COUNTS_WINDOW_DAYS 日）
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object} { "1": { "total": 50, "wins": 28, "top2": 35, "top3": 40 }, "2": { ... } }
 */
async function calculateCourseRaceCounts(racerId, venueCode = null) {
  const since = getDateDaysAgo(COURSE_RACE_COUNTS_WINDOW_DAYS);
  const fetched = await fetchEntriesAndResults(
    racerId,
    venueCode,
    since,
    COURSE_RACE_COUNTS_SELECT,
  );
  if (!fetched) {
    return null;
  }

  const resultsMap = new Map();
  for (const r of fetched.allResults) {
    resultsMap.set(r.race_id, r);
  }

  const courseCounts = tallyCourseRaceCounts(
    fetched.filteredEntries,
    resultsMap,
  );

  return Object.keys(courseCounts).length > 0 ? courseCounts : null;
}

// ===== 進入コース傾向算出 =====

// 進入コース傾向の集計期間（直近12ヶ月）
const COURSE_ENTRY_WINDOW_DAYS = 365;

/**
 * 選手の進入コース傾向（枠番→実際に進入したコースの回数）を算出する
 * （BOA-284、docs/design/course-entry-tendency-rework/）。
 * 実進入コースはrace_results.actual_course_1〜6（BOA-257、Kファイル由来）。
 * 走数の下限は適用せず、回数と走数をそのまま保存する（5走未満を「参考」として
 * 扱うのは表示側の責務）。
 *
 * 他の3関数（calculateCourseRaceCounts等）は旧列course_1〜6のままにしている。
 * course_1〜6は艇番と常に一致するため実態は枠番別の集計だが、実進入コースに
 * 切り替えても予測力は上がらず複勝予想の的中率がわずかに下がったため
 * （scripts/analysis/compare-course-rate-sources.js、BOA-284 Task 2）現行を維持する。
 * @param {number} racerId - 選手登録番号
 * @param {number|null} venueCode - 会場コード（nullの場合は全会場）
 * @returns {Object|null} { since, all: { 枠番: { n, courses: { コース: 回数 } } },
 *   venues: { 会場コード: { 枠番: { n, courses } } } }
 *   allは対象の出走全体（会場指定時はその会場のみ）、venuesは対象の出走の会場別内訳
 */
async function calculateCourseEntryTendency(racerId, venueCode = null) {
  const since = getDateDaysAgo(COURSE_ENTRY_WINDOW_DAYS);

  const filteredEntries = await fetchFilteredEntries(racerId, venueCode, since);

  if (filteredEntries.length === 0) {
    return null;
  }

  // 2. race_results から実進入コースを取得
  const resultsByRaceId = new Map(
    (
      await fetchResultsForEntries(
        filteredEntries,
        `race_id, ${ACTUAL_COURSE_SELECT}`,
      )
    ).map((r) => [r.race_id, r]),
  );

  // 3. 枠番ごと・会場ごとに実際のコースの回数を集計
  return buildCourseEntryTendency(filteredEntries, resultsByRaceId, since);
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

  return buildRacerRecord(racerId, venueCode, {
    stStats,
    attackDist,
    defenseDist,
    courseTendency,
    courseRaceCounts,
  });
}

/** ST統計（無ければ null 埋め）の列 */
function stColumns(stStats) {
  return {
    avg_st: stStats?.avg_st ?? null,
    avg_st_last_30: stStats?.avg_st_last_30 ?? null,
    st_stddev: stStats?.st_stddev ?? null,
    flying_rate: stStats?.flying_rate ?? null,
  };
}

/** upsert用の1行（列の順を変えない） */
function buildRacerRecord(
  racerId,
  venueCode,
  { stStats, attackDist, defenseDist, courseTendency, courseRaceCounts },
) {
  return {
    racer_id: racerId,
    venue_code: venueCode,
    ...stColumns(stStats),
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
  // 変わった行だけ書く（BOA-600）。以前は1日2回、全1,639行を無条件に UPDATE していた
  // （data-acquisition.md「変更の無い行は書かない」）。calculated_at は毎回変わるので比較から外す
  // （値が変わったときだけ、新しい calculated_at で書き込まれる）
  const { error, toWrite } = await upsertChangedRows(
    supabase,
    "racer_aggregated_stats",
    [record],
    {
      onConflict: "racer_id,venue_code",
      keyColumns: ["racer_id", "venue_code"],
      chunkColumn: "racer_id",
      ignoreColumns: ["calculated_at"],
      label: `racer_aggregated_stats (racer=${record.racer_id}, venue=${record.venue_code})`,
      dryRun,
    },
  );

  if (error) {
    console.error(
      `  upsertエラー (racer=${record.racer_id}, venue=${record.venue_code}):`,
      error.message,
    );
    return false;
  }

  writeCounts.changed += toWrite.length;
  writeCounts.unchanged += 1 - toWrite.length;
  return true;
}

// 書き込んだ行（値が変わった行）と、変わらず書かなかった行の数。最後に出す（BOA-600）
const writeCounts = { changed: 0, unchanged: 0 };

// ===== 結果表示 =====

/** コースごとの決まり手の割合を、割合の大きい順に1コース1行で出す */
function printTechDistribution(heading, distribution) {
  console.log(heading);
  for (const [course, techs] of Object.entries(distribution)) {
    const techStr = Object.entries(techs)
      .sort((a, b) => b[1] - a[1])
      .map(([t, v]) => `${t}:${(v * 100).toFixed(1)}%`)
      .join(", ");
    console.log(`    ${course}コース: ${techStr}`);
  }
}

function printCourseRaceCounts(courseRaceCounts) {
  console.log(`  コース別出走数:`);
  for (const [course, counts] of Object.entries(courseRaceCounts)) {
    const rate = (n) =>
      counts.total > 0 ? ((n / counts.total) * 100).toFixed(1) : "0.0";
    console.log(
      `    ${course}コース: ${counts.total}走 ${counts.wins}勝 (勝率${rate(counts.wins)}% 2連率${rate(counts.top2 ?? 0)}% 3連率${rate(counts.top3 ?? 0)}%)`,
    );
  }
}

function printCourseEntryTendency(tendency) {
  const line = (boat, { n, courses }) => {
    const courseStr = Object.entries(courses)
      .sort((a, b) => b[1] - a[1])
      .map(([c, count]) => `${c}コース:${count}走`)
      .join(", ");
    return `${boat}号艇 (${n}走): ${courseStr}`;
  };
  console.log(`  進入コース傾向（${tendency.since}以降）:`);
  for (const [boat, entry] of Object.entries(tendency.all)) {
    console.log(`    ${line(boat, entry)}`);
  }
  console.log(`    会場別: ${Object.keys(tendency.venues).length}会場分を保存`);
}

function printRacerHeader(record) {
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
}

function printRacerStats(record) {
  printRacerHeader(record);

  if (record.attack_distribution) {
    printTechDistribution(`  決まり手分布:`, record.attack_distribution);
  }

  if (
    record.defense_distribution &&
    Object.keys(record.defense_distribution).length > 0
  ) {
    printTechDistribution(`  被攻撃分布:`, record.defense_distribution);
  }

  if (
    record.course_race_counts &&
    Object.keys(record.course_race_counts).length > 0
  ) {
    printCourseRaceCounts(record.course_race_counts);
  }

  if (record.course_entry_tendency) {
    printCourseEntryTendency(record.course_entry_tendency);
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
      // 途中で止めると一部の選手だけを集計して成功に見えるため、例外にする（BOA-581）
      throw new Error(`race_entries取得エラー（全選手ID）: ${error.message}`);
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

function printUsage() {
  console.log("使い方:");
  console.log("  node scripts/analysis/aggregate-racer-stats.js --racer=4203");
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
}

/** 単一選手モード: 集計した1行を表示して保存する */
async function saveSingleRecord(record, dryRun) {
  printRacerStats(record);
  const ok = await upsertRacerStats(record, dryRun);
  if (ok && !dryRun) console.log("  -> racer_aggregated_stats に保存しました");
}

/** --- 単一選手モード --- */
export async function runSingleRacer(racerId, venueCode, dryRun) {
  console.log(`選手 ${racerId} の統計を集計中...`);

  // 全会場の統計
  const record = await aggregateRacer(racerId, 0);
  if (record) {
    await saveSingleRecord(record, dryRun);
  } else {
    console.log(`  選手 ${racerId} のデータが見つかりません`);
  }

  // 会場指定がある場合は会場別統計も算出
  if (venueCode) {
    const venueRecord = await aggregateRacer(racerId, venueCode);
    if (venueRecord) {
      await saveSingleRecord(venueRecord, dryRun);
    } else {
      console.log(`  選手 ${racerId} の会場${venueCode}データが見つかりません`);
    }
  }

  console.log(
    `  racer_aggregated_stats: 値が変わった ${writeCounts.changed}行、変更なし ${writeCounts.unchanged}行`,
  );
}

/** 全選手モード: 進捗表示（50人ごと） */
function printProgress(processed, total, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = ((processed / (Date.now() - startTime)) * 1000).toFixed(1);
  console.log(
    `  進捗: ${processed}/${total} (${((processed / total) * 100).toFixed(1)}%) - ${elapsed}秒経過 - ${rate}人/秒`,
  );
}

/**
 * 全選手モードの1人分: 全会場と、会場指定があれば会場別も集計して保存する
 * 1人の取得エラーで全体を止めず、失敗として数えて最後に非0で終わる（BOA-581）
 * @returns {Promise<"skipped"|"succeeded"|"failed">}
 */
async function aggregateAndUpsertRacer(id, venueCode, dryRun) {
  try {
    // 全会場統計
    const record = await aggregateRacer(id, 0);
    if (!record) {
      return "skipped";
    }

    let ok = await upsertRacerStats(record, dryRun);

    // 会場指定がある場合は会場別統計も算出（失敗は全会場と同じく失敗に数える）
    if (venueCode) {
      const venueRecord = await aggregateRacer(id, venueCode);
      if (venueRecord && !(await upsertRacerStats(venueRecord, dryRun))) {
        ok = false;
      }
    }

    return ok ? "succeeded" : "failed";
  } catch (err) {
    console.error(`  集計エラー (racer=${id}): ${err.message}`);
    return "failed";
  }
}

function printAllSummary(counts, startTime, dryRun) {
  const { processed, succeeded, skipped, failedIds } = counts;
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n集計完了:`);
  console.log(`  処理: ${processed}人`);
  console.log(`  成功: ${succeeded}人`);
  console.log(`  スキップ: ${skipped}人 (データ不足)`);
  console.log(
    `  失敗: ${failedIds.length}人${failedIds.length > 0 ? ` (${failedIds.slice(0, 20).join(", ")}${failedIds.length > 20 ? " ほか" : ""})` : ""}`,
  );
  console.log(`  所要時間: ${totalTime}秒`);
  console.log(
    `  racer_aggregated_stats: 値が変わった ${writeCounts.changed}行${dryRun ? "（書く予定）" : "を書き込み"}、変更なし ${writeCounts.unchanged}行は書かない`,
  );
  if (dryRun) {
    console.log("  [dry-run] DB書き込みはスキップされました");
  }
}

/** --- 全選手モード --- */
async function runAllRacers(venueCode, dryRun) {
  console.log("全選手の統計集計を開始します...\n");

  const racerIds = await getAllRacerIds();
  const counts = { processed: 0, succeeded: 0, skipped: 0, failedIds: [] };
  const startTime = Date.now();

  for (const id of racerIds) {
    counts.processed++;

    if (counts.processed % 50 === 0) {
      printProgress(counts.processed, racerIds.length, startTime);
    }

    const outcome = await aggregateAndUpsertRacer(id, venueCode, dryRun);
    if (outcome === "skipped") counts.skipped++;
    else if (outcome === "succeeded") counts.succeeded++;
    else counts.failedIds.push(id);
  }

  printAllSummary(counts, startTime, dryRun);
  if (counts.failedIds.length > 0) process.exitCode = 1;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase環境変数が未設定です");
    process.exit(1);
  }

  const { racerId, venueCode, all, dryRun } = parseArgs();

  if (!racerId && !all) {
    printUsage();
    process.exit(0);
  }

  if (dryRun) {
    console.log("[dry-run] DBへの書き込みはスキップされます\n");
  }

  if (racerId && !all) {
    await runSingleRacer(racerId, venueCode, dryRun);
    return;
  }

  if (all) {
    await runAllRacers(venueCode, dryRun);
  }
}

// 直接起動のときだけ main を回す（import されただけなら argv の解析・DB の読み書き・process.exit は走らない。verify が runSingleRacer を偽の DB で呼ぶため）
if (isDirectRun(import.meta.url)) {
  main().catch((err) => {
    console.error("実行エラー:", err);
    process.exit(1);
  });
}
