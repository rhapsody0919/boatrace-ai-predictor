/**
 * 展開予測の会場別深掘り分析
 *
 * turn-prediction-accuracy-final.js の判定ロジック（UI表示順 上位3技術）をベースに、
 * 低精度会場の外れパターン / 高精度会場の成功要因を会場特性とともに抽出する。
 *
 * 出力: data/analysis/turn-prediction-venue-analysis.json
 */

import { supabase } from "../lib/supabaseClient.js";
import { promises as fs } from "fs";
import path from "path";
import { VENUE_1COURSE_WIN_RATE } from "../lib/venueParameters.js";
import {
  pct,
  failurePatterns,
  successFactors,
} from "./turnPredictionVenuePatterns.js";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

const LOW_VENUES = ["1", "4", "14"]; // 桐生・平和島・鳴門
const HIGH_VENUES = ["19", "18", "6"]; // 下関・徳山・浜名湖

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 期間内の結果が存在するレースID
async function fetchTargetRaceIds(startDateStr, endDateStr) {
  const { data: resultRaceIds } = await supabase
    .from("race_results")
    .select("race_id")
    .gte("race_id", startDateStr + "-00-00")
    .lte("race_id", endDateStr + "-99-99");

  return resultRaceIds?.map((r) => r.race_id) || [];
}

// predictions（standard モデル）
async function fetchPredictions(targetRaceIds) {
  const batchSize = 100;
  let predictions = [];
  for (let i = 0; i < targetRaceIds.length; i += batchSize) {
    const batch = targetRaceIds.slice(i, i + batchSize);
    const { data: batchPreds } = await supabase
      .from("predictions")
      .select("prediction_id, race_id, model_id, feature_contributions")
      .in("race_id", batch)
      .eq("model_id", "standard");
    predictions = predictions.concat(batchPreds || []);
  }
  return predictions;
}

// races / race_results / race_entries / race_conditions をページネーション取得
async function fetchRaceTables(raceIds) {
  let races = [],
    raceResults = [],
    raceEntries = [],
    raceConditions = [];
  for (let i = 0; i < raceIds.length; i += 200) {
    const batch = raceIds.slice(i, i + 200);
    const { data: rb } = await supabase
      .from("races")
      .select(
        "race_id, venue_code, race_number, race_date, volatility_score, volatility_level, first_boat_grade, first_boat_win_rate, race_grade",
      )
      .in("race_id", batch);
    races = races.concat(rb || []);

    const { data: rr } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, course_1, course_2, course_3, course_4, course_5, course_6, winning_technique",
      )
      .in("race_id", batch);
    raceResults = raceResults.concat(rr || []);

    const { data: re } = await supabase
      .from("race_entries")
      .select("race_id, boat_number, grade, win_rate")
      .in("race_id", batch);
    raceEntries = raceEntries.concat(re || []);

    const { data: rc } = await supabase
      .from("race_conditions")
      .select("race_id, weather, wind_speed, wind_direction, wave_height")
      .in("race_id", batch);
    raceConditions = raceConditions.concat(rc || []);
  }
  return { races, raceResults, raceEntries, raceConditions };
}

function indexByRaceId({ races, raceResults, raceEntries, raceConditions }) {
  const racesById = {};
  for (const r of races) racesById[r.race_id] = r;
  const resultsByRaceId = {};
  for (const r of raceResults) resultsByRaceId[r.race_id] = r;
  const conditionsByRaceId = {};
  for (const c of raceConditions) conditionsByRaceId[c.race_id] = c;
  const entriesByRaceId = {};
  for (const e of raceEntries) {
    if (!entriesByRaceId[e.race_id]) entriesByRaceId[e.race_id] = {};
    entriesByRaceId[e.race_id][e.boat_number] = e;
  }
  return { racesById, resultsByRaceId, conditionsByRaceId, entriesByRaceId };
}

// UI表示順の上位3技術の winnerCourse と、その一覧
function topTurnCourses(turnPred) {
  const distribution = turnPred.distribution;
  const patterns = turnPred.patterns || [];

  const sortedTechs = Object.entries(distribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);
  const topTechs = sortedTechs.map(([tech, prob]) => {
    const pattern = patterns.find((p) => p.technique === tech);
    return {
      technique: tech,
      probability: prob,
      winnerCourse: pattern?.winnerCourse || null,
    };
  });
  return topTechs
    .filter((t) => t.winnerCourse)
    .map((t) => t.winnerCourse)
    .slice(0, 3);
}

// 風・波・天候・荒れ度・勝者の級別/勝率（欠測は null）
function conditionFields(raceInfo, cond, winnerEntry) {
  return {
    wind_speed: cond.wind_speed != null ? cond.wind_speed : null,
    wave_height: cond.wave_height != null ? cond.wave_height : null,
    weather: cond.weather || null,
    volatility_score:
      raceInfo.volatility_score != null ? raceInfo.volatility_score : null,
    winner_grade: winnerEntry.grade || null,
    winner_win_rate: winnerEntry.win_rate != null ? winnerEntry.win_rate : null,
  };
}

// レース単位で判定 + 特徴抽出（判定できないレースは null）
function buildRecord(pred, idx) {
  const raceResult = idx.resultsByRaceId[pred.race_id];
  const raceInfo = idx.racesById[pred.race_id];
  if (!raceResult || !raceInfo) return null;

  const firstBoat = raceResult.rank1;
  if (!firstBoat) return null;
  const firstBoatCourse = raceResult[`course_${firstBoat}`];
  if (!firstBoatCourse) return null;

  const turnPred = pred.turnPrediction;
  const patterns = turnPred.patterns || [];
  const topCourses = topTurnCourses(turnPred);
  const isHit = topCourses.includes(firstBoatCourse);

  const topPattern = patterns[0] || {};
  const entries = idx.entriesByRaceId[pred.race_id] || {};
  const winnerEntry = entries[firstBoat] || {};
  const cond = idx.conditionsByRaceId[pred.race_id] || {};

  return {
    race_id: pred.race_id,
    venue_code: String(raceInfo.venue_code),
    race_number: raceInfo.race_number,
    hit: isHit,
    actual_course: firstBoatCourse,
    actual_technique: raceResult.winning_technique || null,
    predicted_top_course: topPattern.winnerCourse || null,
    predicted_top_technique: topPattern.technique || null,
    predicted_top_probability: topPattern.probability || null,
    predicted_courses: topCourses,
    ...conditionFields(raceInfo, cond, winnerEntry),
  };
}

// 決まり手別 的中率
function buildTechHitRate(recs) {
  const techHitRate = {};
  for (const r of recs) {
    const t = r.actual_technique || "unknown";
    if (!techHitRate[t]) techHitRate[t] = { total: 0, hits: 0 };
    techHitRate[t].total++;
    if (r.hit) techHitRate[t].hits++;
  }
  const techHitRatePct = {};
  for (const [t, v] of Object.entries(techHitRate)) {
    techHitRatePct[t] = {
      total: v.total,
      hits: v.hits,
      rate: pct(v.hits, v.total),
    };
  }
  return techHitRatePct;
}

// 風・波の的中率影響
function buildWindHitRate(recs) {
  const windBuckets = {
    calm: { t: 0, h: 0 },
    moderate: { t: 0, h: 0 },
    strong: { t: 0, h: 0 },
  };
  for (const r of recs) {
    const ws = r.wind_speed;
    let b = "calm";
    if (ws != null && ws >= 5) b = "strong";
    else if (ws != null && ws >= 3) b = "moderate";
    windBuckets[b].t++;
    if (r.hit) windBuckets[b].h++;
  }
  const windHitRate = {};
  for (const [k, v] of Object.entries(windBuckets)) {
    windHitRate[k] = { total: v.t, hits: v.h, rate: pct(v.h, v.t) };
  }
  return windHitRate;
}

// 会場別プロファイル生成
function buildProfile(records, venueCode) {
  const recs = records.filter((r) => r.venue_code === venueCode);
  const hits = recs.filter((r) => r.hit);
  const misses = recs.filter((r) => !r.hit);
  const venueKey = venueCode.padStart(2, "0");

  // 不的中の実際の決まり手分布
  const missTech = {};
  for (const r of misses) {
    const t = r.actual_technique || "unknown";
    missTech[t] = (missTech[t] || 0) + 1;
  }
  const hitTech = {};
  for (const r of hits) {
    const t = r.actual_technique || "unknown";
    hitTech[t] = (hitTech[t] || 0) + 1;
  }

  // 実際の1着コース分布（全体・不的中）
  const actualCourseAll = {};
  const actualCourseMiss = {};
  for (const r of recs)
    actualCourseAll[r.actual_course] =
      (actualCourseAll[r.actual_course] || 0) + 1;
  for (const r of misses)
    actualCourseMiss[r.actual_course] =
      (actualCourseMiss[r.actual_course] || 0) + 1;

  // 予測トップ vs 実績の比較（不的中時にモデルが何を予測したか）
  const predTopCourseMiss = {};
  const predTopTechMiss = {};
  for (const r of misses) {
    predTopCourseMiss[r.predicted_top_course] =
      (predTopCourseMiss[r.predicted_top_course] || 0) + 1;
    predTopTechMiss[r.predicted_top_technique] =
      (predTopTechMiss[r.predicted_top_technique] || 0) + 1;
  }

  const techHitRatePct = buildTechHitRate(recs);

  // 1コース実績勝率（このデータ期間内）
  const course1Wins = recs.filter((r) => r.actual_course === 1).length;
  const course1Rate = pct(course1Wins, recs.length);

  // 1コース予測時の的中率（モデルが逃げ＝1コースをトップに予測したレース）
  const predIn = recs.filter((r) => r.predicted_top_course === 1);
  const predInHits = predIn.filter((r) => r.hit).length;

  const windHitRate = buildWindHitRate(recs);

  return {
    name: VENUE_NAMES[Number(venueCode)],
    accuracy: pct(hits.length, recs.length) / 100,
    total_races: recs.length,
    hits: hits.length,
    venue_1course_param: VENUE_1COURSE_WIN_RATE[venueKey],
    venue_1course_actual_rate: course1Rate / 100,
    actual_winning_course_distribution: actualCourseAll,
    missed_race_actual_course_distribution: actualCourseMiss,
    missed_race_actual_technique_distribution: missTech,
    hit_race_actual_technique_distribution: hitTech,
    missed_race_model_predicted_top_course: predTopCourseMiss,
    missed_race_model_predicted_top_technique: predTopTechMiss,
    hit_rate_by_actual_technique: techHitRatePct,
    hit_rate_by_wind: windHitRate,
    model_in_prediction: {
      races_model_predicted_course1_top: predIn.length,
      hits: predInHits,
      rate: pct(predInHits, predIn.length) / 100,
    },
  };
}

// 全会場サマリ（参考）
function buildAllVenues(records) {
  const allVenues = {};
  for (const vc of [...new Set(records.map((r) => r.venue_code))]) {
    const recs = records.filter((r) => r.venue_code === vc);
    const hits = recs.filter((r) => r.hit).length;
    allVenues[vc] = {
      name: VENUE_NAMES[Number(vc)],
      total: recs.length,
      hits,
      accuracy: pct(hits, recs.length) / 100,
    };
  }
  return allVenues;
}

// コンソールサマリ
function printVenueSummary(heading, accByVenue, linesKey) {
  console.log(heading);
  for (const [vc, p] of Object.entries(accByVenue)) {
    console.log(
      `\n${vc}:${p.name} 精度${(p.accuracy * 100).toFixed(0)}% (${p.hits}/${p.total_races})`,
    );
    p[linesKey].forEach((x) => console.log(`  - ${x}`));
  }
}

async function main() {
  console.log("🚀 展開予測 会場別深掘り分析\n");

  const endDate = new Date();
  let startDate = new Date("2026-03-10");
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  console.log(`📅 分析期間: ${startDateStr} ～ ${endDateStr}\n`);

  // 1. 期間内の結果が存在するレースID
  const targetRaceIds = await fetchTargetRaceIds(startDateStr, endDateStr);
  console.log(`✅ 対象レース: ${targetRaceIds.length}\n`);

  // 2. predictions（standard モデル）
  const predictions = await fetchPredictions(targetRaceIds);

  const withTurnPred = predictions
    .map((p) => ({
      ...p,
      turnPrediction: p.feature_contributions?.turnPrediction,
    }))
    .filter((p) => p.turnPrediction && p.turnPrediction.distribution);
  console.log(`✅ turnPrediction あり: ${withTurnPred.length}\n`);

  const raceIds = [...new Set(withTurnPred.map((p) => p.race_id))];

  // 3. races / race_results / race_entries / race_conditions をページネーション取得
  const idx = indexByRaceId(await fetchRaceTables(raceIds));

  // 4. レース単位で判定 + 特徴抽出
  const records = [];
  for (const pred of withTurnPred) {
    const record = buildRecord(pred, idx);
    if (record) records.push(record);
  }
  console.log(`✅ 判定済みレコード: ${records.length}\n`);

  // 5-7. 会場別プロファイル生成・外れパターン・成功要因
  const lowAcc = {};
  for (const vc of LOW_VENUES) {
    const p = buildProfile(records, vc);
    lowAcc[vc] = { ...p, common_failure_patterns: failurePatterns(p) };
  }
  const highAcc = {};
  for (const vc of HIGH_VENUES) {
    const p = buildProfile(records, vc);
    highAcc[vc] = { ...p, success_factors: successFactors(p) };
  }

  // 8. 全会場サマリ（参考）
  const allVenues = buildAllVenues(records);

  const output = {
    analysis_date: formatDate(new Date()),
    period: { start: startDateStr, end: endDateStr },
    methodology:
      "UI表示順の上位3技術のwinnerCourseに実績1着コースが含まれれば的中（turn-prediction-accuracy-final.js準拠）",
    total_records: records.length,
    low_accuracy_venues: lowAcc,
    high_accuracy_venues: highAcc,
    all_venue_summary: allVenues,
  };

  const outputPath = path.join(
    "data/analysis",
    "turn-prediction-venue-analysis.json",
  );
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 保存: ${outputPath}`);

  printVenueSummary(
    "\n📉 === 低精度会場 ===",
    lowAcc,
    "common_failure_patterns",
  );
  printVenueSummary("\n📈 === 高精度会場 ===", highAcc, "success_factors");
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
