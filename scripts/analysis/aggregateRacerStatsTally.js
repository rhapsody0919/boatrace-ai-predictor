// aggregate-racer-stats.js から字のまま移した集計の純粋な部品（艇→コース・決まり手の数え・比率・保存する行の組み立て）。DB に触らない

import {
  COURSE_DEFAULT_DISTRIBUTION,
  toTechniqueKey,
} from "../lib/winningTechniques.js";

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

export {
  findCourseOfBoat,
  buildEntryBoatMap,
  toCourseRatios,
  tallyWinTechniques,
  tallyLossTechniques,
  buildRacerRecord,
};
