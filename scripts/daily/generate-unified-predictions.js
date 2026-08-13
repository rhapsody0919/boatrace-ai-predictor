/**
 * 新AI予想モデル「unified」朝の日次バッチ（Task9a、オッズ不要）
 *
 * FR1複勝予想・FR2展開予測・FR3イン崩れバッジを算出し、predictions（model_id='unified'）へ
 * 書き込む。FR4（3連単参考情報）はオッズが必要なため、別バッチ
 * generate-unified-trifecta-reference.js（Task9b、発走前）で扱う（plan.md参照）。
 *
 * predictions.top_pick/top_2nd/top_3rd の意味（model_id='unified'の場合）:
 *   top_pick = 複勝予想1位艇、top_2nd = 複勝予想2位艇、top_3rd = 未使用（null）
 *   ※他モデル（standard等）とは意味が異なる。feature_contributions.placeRecommendationが正本
 *
 * 使い方:
 *   node scripts/daily/generate-unified-predictions.js              # 今日
 *   node scripts/daily/generate-unified-predictions.js --date=2026-08-13
 *   node scripts/daily/generate-unified-predictions.js --dry-run
 */

import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import {
  calculateVolatilityComposite,
  toVolatilityPercentile,
} from "../lib/volatilityFactors.js";

const MODEL_ID = "unified";
const VOLATILITY_LOOKBACK_DAYS = 90;
const FALLBACK_PERCENTILE = 0.5; // 分布データが不足する場合のフォールバック（運用開始直後）
const MIN_DISTRIBUTION_SAMPLES = 20; // これ未満ならフォールバックを使う

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function fetchRaceDataFromSupabase(raceIds) {
  // ⚠️ Supabaseのデフォルトlimitは1000行。180レース×6艇=1080行等、対象日によっては
  // 単純な.select("*").in()だと後方の会場が無条件に切り捨てられる（2026-08-13判明、
  // 大村12レース全滅で発覚）。fetchAll（.range()ページネーション）必須
  const [entriesData, conditionsData] = await Promise.all([
    fetchAll("race_entries", "*", (q) => q.in("race_id", raceIds)),
    fetchAll("race_conditions", "*", (q) => q.in("race_id", raceIds)),
  ]);

  const entriesByRace = new Map();
  for (const e of entriesData || []) {
    if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
    entriesByRace.get(e.race_id).push(e);
  }
  const conditionsByRace = new Map(
    (conditionsData || []).map((c) => [c.race_id, c]),
  );

  const races = [];
  for (const raceId of raceIds) {
    const entries = entriesByRace.get(raceId);
    if (!entries || entries.length < 6) continue;

    const parts = raceId.split("-");
    const venueCode = parseInt(parts[3], 10);
    const cond = conditionsByRace.get(raceId) || {};

    races.push({
      raceId,
      venueCode,
      entries: entries.sort((a, b) => a.boat_number - b.boat_number),
      windSpeed: cond.wind_speed ?? null,
      waveHeight: cond.wave_height ?? null,
    });
  }
  return races;
}

async function fetchRacerStats(racerIds) {
  if (!isSupabaseEnabled() || racerIds.length === 0) return new Map();
  const map = new Map();
  const CHUNK_SIZE = 900;
  for (let i = 0; i < racerIds.length; i += CHUNK_SIZE) {
    const chunk = racerIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("racer_aggregated_stats")
      .select(
        "racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts",
      )
      .in("racer_id", chunk)
      .eq("venue_code", 0);
    if (error) {
      console.error("racer_aggregated_stats取得エラー:", error.message);
      continue;
    }
    data?.forEach((r) => map.set(r.racer_id, r));
  }
  return map;
}

/**
 * FR1複勝予想: コース別勝率が高い上位2艇を選出する（EV計算不要、backtest-course-rate-only.jsと同じロジック）
 */
function calculatePlaceRecommendation(entries, racerStatsMap) {
  const courseRates = entries.map((e) => {
    const stats = racerStatsMap.get(e.racer_id);
    const counts = stats?.course_race_counts?.[String(e.boat_number)];
    const rate = counts?.total
      ? ((counts.wins ?? 0) / counts.total) * 100
      : null;
    return { boat: e.boat_number, rate };
  });

  const valid = courseRates.filter((c) => c.rate != null);
  const sorted = [...valid].sort((a, b) => b.rate - a.rate);
  const boats = sorted.slice(0, 2).map((c) => c.boat);

  return {
    boats, // 複勝予想上位2艇（データ不足時は1艇以下になりうる）
    courseRates: Object.fromEntries(courseRates.map((c) => [c.boat, c.rate])),
  };
}

/**
 * FR3イン崩れバッジ用の会場内パーセンタイル分布を取得する。
 * predictions（model_id='unified'）の蓄積データから直近N日・同会場のcomposite値を集める。
 * 運用開始直後等でサンプル不足の場合は空配列を返し、呼び出し側でフォールバックする。
 */
async function fetchVolatilityDistribution(venueCode, beforeDate) {
  const cutoff = new Date(beforeDate);
  cutoff.setDate(cutoff.getDate() - VOLATILITY_LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // 90日分・全会場のpredictionsを取得後にvenueCodeで絞り込む（race_idのvenue部分は
  // 中間位置のためDB側での範囲指定ができない）。運用開始直後は件数が少ないが、
  // 蓄積後は90日×全会場で1000行を超えうるためfetchAll必須
  const data = await fetchAll(
    "predictions",
    "race_id, feature_contributions",
    (q) =>
      q
        .eq("model_id", MODEL_ID)
        .gte("race_id", cutoffStr)
        .lt("race_id", beforeDate),
  );

  const prefix = `-${String(venueCode).padStart(2, "0")}-`;
  return (data || [])
    .filter((row) => row.race_id.includes(prefix))
    .map((row) => row.feature_contributions?.volatilityComposite)
    .filter((v) => typeof v === "number");
}

async function main() {
  const { dryRun } = parseArgs();
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}${dryRun ? " [DRY-RUN]" : ""}`);

  const schedule = await getRaceSchedule(date);
  const raceIds = schedule.map((r) => r.race_id);
  if (raceIds.length === 0) {
    console.log("📭 対象レースなし");
    return;
  }
  console.log(`🎯 対象: ${raceIds.length}レース`);

  const races = await fetchRaceDataFromSupabase(raceIds);
  if (races.length === 0) {
    console.log("📭 race_entriesが未登録のため対象レースなし");
    return;
  }

  const allRacerIds = new Set();
  for (const race of races) {
    for (const e of race.entries) {
      if (e.racer_id) allRacerIds.add(e.racer_id);
    }
  }
  const racerStatsMap = await fetchRacerStats([...allRacerIds]);
  console.log(`📊 ${racerStatsMap.size}人の選手統計を取得しました`);

  // 会場別のイン崩れ分布を事前取得（レースごとに毎回問い合わせない）
  const venueCodes = [...new Set(races.map((r) => r.venueCode))];
  const volatilityDistByVenue = new Map();
  for (const venueCode of venueCodes) {
    const dist = await fetchVolatilityDistribution(venueCode, date);
    volatilityDistByVenue.set(venueCode, dist);
  }

  const predictionsData = [];
  for (const race of races) {
    const turnPredictionPlayers = race.entries.map((e) => {
      const stats = racerStatsMap.get(e.racer_id);
      return {
        boatNumber: e.boat_number,
        course: e.boat_number,
        avgST: stats?.avg_st ?? null,
        stStddev: stats?.st_stddev ?? null,
        attackDistribution: stats?.attack_distribution || null,
        defenseDistribution: stats?.defense_distribution || null,
        courseRaceCounts: stats?.course_race_counts || null,
        motor2Rate: e.motor_2rate,
        grade: e.grade,
        globalWinRate: e.win_rate,
        localWinRate: e.local_win_rate,
      };
    });

    const turnPrediction = predictFirstMark(turnPredictionPlayers, {
      venueCode: race.venueCode,
      windSpeed: race.windSpeed,
      waveHeight: race.waveHeight,
    });

    const placeRecommendation = calculatePlaceRecommendation(
      race.entries,
      racerStatsMap,
    );

    const volatility = calculateVolatilityComposite(
      race.entries.map((e) => ({ number: e.boat_number, winRate: e.win_rate })),
      race.venueCode,
      turnPrediction,
      race.entries.map((e) => ({
        boatNumber: e.boat_number,
        avgST: racerStatsMap.get(e.racer_id)?.avg_st ?? null,
      })),
    );

    const dist = volatilityDistByVenue.get(race.venueCode) || [];
    const volatilityPercentile =
      dist.length >= MIN_DISTRIBUTION_SAMPLES
        ? toVolatilityPercentile(volatility.composite, dist)
        : FALLBACK_PERCENTILE;

    predictionsData.push({
      race_id: race.raceId,
      model_id: MODEL_ID,
      top_pick: placeRecommendation.boats[0] ?? race.entries[0].boat_number,
      top_2nd: placeRecommendation.boats[1] ?? null,
      top_3rd: null,
      confidence: null,
      is_shadow: false,
      feature_contributions: {
        placeRecommendation,
        turnPrediction,
        volatilityComposite: volatility.composite,
        volatilityPercentile,
        volatilityReasons: volatility.reasons,
      },
    });
  }

  console.log(`\n📊 ${predictionsData.length}レース分の予測を生成しました`);

  if (dryRun) {
    console.log("[DRY-RUN] Supabase書き込みはスキップ");
    console.log(JSON.stringify(predictionsData[0], null, 2));
    return;
  }

  const updatedRaceIds = predictionsData.map((r) => r.race_id);
  const { error: deleteError } = await supabase
    .from("predictions")
    .delete()
    .in("race_id", updatedRaceIds)
    .eq("model_id", MODEL_ID)
    .eq("is_shadow", false);
  if (deleteError) {
    console.error("❌ predictions削除エラー:", deleteError.message);
    return;
  }

  for (let i = 0; i < predictionsData.length; i += 1000) {
    const batch = predictionsData.slice(i, i + 1000);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) console.error("❌ predictions書き込みエラー:", error.message);
  }
  console.log(`✅ predictions: ${predictionsData.length}件書き込み完了`);
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
