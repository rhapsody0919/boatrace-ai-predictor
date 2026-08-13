/**
 * unifiedModel.js の2着・3着確率（softmax変換）キャリブレーション検証
 *
 * backtest-unified-model.js で「EV最大1点」が「全パターン参考」より悪化する不自然な
 * 結果が続いたため、EV計算の入力である combinedProbability（1着×2着×3着の同時確率）の
 * 精度を疑い、まず2着・3着の確率推定単体を検証する。
 *
 * 検証方法（条件付きキャリブレーション）:
 * - 1着が的中したパターン（pattern.winnerCourse === 実際の1着艇）に限定し、
 *   softmax変換で算出した2着候補の予測確率(secondProbability)と、実際に2着だったかを突き合わせる
 * - 同様に、1着・2着が的中したサンプルに限定して3着候補の予測確率(thirdProbability)を検証する
 * - 確率帯別（calibration-report.jsと同じ10%刻み）に平均予測確率と実現率の乖離を見る
 *
 * オッズ不要のため、trifecta_all期間に限定せず対象期間を広く取れる。
 *
 * 使い方:
 *   node scripts/analysis/calibrate-unified-model.js --from=2026-07-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import {
  calculateUnifiedScores,
  softmaxProbabilities,
} from "../lib/unifiedModel.js";
import { fetchRaceIndicatorData } from "../lib/raceIndicatorData.js";

// softmax温度のグリッドサーチ候補
// v3（unifiedModel.js Zスコア化、2026-08-12）でスコアレンジが生値ベース(200-300)から
// Zスコア×重み合計(-77〜94程度)へ大きく変わったため、より小さい温度も含めて再探索する
const TEMP_CANDIDATES = [5, 10, 20, 30, 50, 80, 120, 200, 300, 500];

function weightedGap(samples) {
  const buckets = new Map();
  for (const s of samples) {
    const b = bucketOf(s.predicted);
    if (!buckets.has(b)) buckets.set(b, { sumP: 0, hit: 0, n: 0 });
    const acc = buckets.get(b);
    acc.sumP += s.predicted;
    acc.hit += s.actual ? 1 : 0;
    acc.n += 1;
  }
  let totalGapWeighted = 0;
  let totalN = 0;
  for (const v of buckets.values()) {
    const avgP = v.sumP / v.n;
    const actual = v.hit / v.n;
    totalGapWeighted += Math.abs(avgP - actual) * 100 * v.n;
    totalN += v.n;
  }
  return totalN > 0 ? totalGapWeighted / totalN : NaN;
}

function gridSearchTemperature(label, rawSamples) {
  console.log(`\n=== ${label} 温度グリッドサーチ ===`);
  for (const temp of TEMP_CANDIDATES) {
    const samples = rawSamples.map(({ scores, actualNumber }) => {
      const probs = softmaxProbabilities(scores, temp);
      const top = probs[0];
      return {
        predicted: top?.prob ?? 0,
        actual: top?.number === actualNumber,
      };
    });
    console.log(
      `  temp=${String(temp).padStart(5)}  加重平均乖離=${weightedGap(samples).toFixed(2)}pt`,
    );
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

function bucketOf(p) {
  const idx = Math.min(9, Math.floor(p * 10));
  return `${idx * 10}-${idx * 10 + 10}%`;
}

function reportBuckets(label, samples) {
  console.log(`\n=== ${label} ===`);
  const buckets = new Map();
  for (const s of samples) {
    const b = bucketOf(s.predicted);
    if (!buckets.has(b)) buckets.set(b, { sumP: 0, hit: 0, n: 0 });
    const acc = buckets.get(b);
    acc.sumP += s.predicted;
    acc.hit += s.actual ? 1 : 0;
    acc.n += 1;
  }
  const sortedKeys = [...buckets.keys()].sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  let totalGapWeighted = 0;
  let totalN = 0;
  for (const key of sortedKeys) {
    const v = buckets.get(key);
    const avgP = v.sumP / v.n;
    const actual = v.hit / v.n;
    const gap = Math.abs(avgP - actual) * 100;
    totalGapWeighted += gap * v.n;
    totalN += v.n;
    console.log(
      `  ${key.padEnd(8)} N=${String(v.n).padStart(5)}  予測=${(avgP * 100).toFixed(1)}%  実現=${(actual * 100).toFixed(1)}%  乖離=${gap.toFixed(1)}pt`,
    );
  }
  if (totalN > 0) {
    console.log(
      `  加重平均乖離: ${(totalGapWeighted / totalN).toFixed(2)}pt (N=${totalN})`,
    );
  }
}

async function main() {
  const { from, to } = parseArgs();
  if (!supabase) {
    console.error("Supabase未設定");
    process.exit(1);
  }

  console.log("対象レース取得中...");
  // ⚠️ Supabaseのデフォルトlimitは1000行。fetchAllで.range()ページネーションする
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, is_cancelled, is_no_race",
    (q) => {
      let query = q.not("rank1", "is", null);
      if (from) query = query.gte("race_id", from);
      if (to) query = query.lte("race_id", to);
      return query;
    },
  );
  const validResults = results.filter((r) => !r.is_cancelled && !r.is_no_race);
  console.log(`  ${validResults.length}件\n`);

  const racerStatsCache = new Map();
  const secondSamples = [];
  const thirdSamples = [];
  const firstSamples = [];
  const secondRawSamples = []; // 温度グリッドサーチ用（生スコア + 実際の艇番号）
  const thirdRawSamples = [];

  let processed = 0;
  for (const result of validResults) {
    const raceId = result.race_id;
    const { data: entries } = await supabase
      .from("race_entries")
      .select(
        "boat_number, racer_id, win_rate, local_win_rate, motor_2rate, grade",
      )
      .eq("race_id", raceId)
      .order("boat_number");
    if (!entries || entries.length < 6) continue;

    const { data: raceRow } = await supabase
      .from("races")
      .select("venue_code")
      .eq("race_id", raceId)
      .single();
    if (!raceRow) continue;

    const { data: conditions } = await supabase
      .from("race_conditions")
      .select("wind_speed, wave_height")
      .eq("race_id", raceId)
      .maybeSingle();

    const racerIdsToFetch = entries
      .map((e) => e.racer_id)
      .filter((id) => id != null && !racerStatsCache.has(id));
    if (racerIdsToFetch.length > 0) {
      const { data: statsRows } = await supabase
        .from("racer_aggregated_stats")
        .select(
          "racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts",
        )
        .in("racer_id", racerIdsToFetch)
        .eq("venue_code", 0);
      for (const s of statsRows ?? []) racerStatsCache.set(s.racer_id, s);
    }

    const players = entries.map((e) => ({
      number: e.boat_number,
      course: e.boat_number,
      racerId: e.racer_id,
      winRate: e.win_rate,
      localWinRate: e.local_win_rate,
      motor2Rate: e.motor_2rate,
      grade: e.grade,
    }));

    const turnPredictionPlayers = entries.map((e) => {
      const stats = racerStatsCache.get(e.racer_id);
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
      venueCode: raceRow.venue_code,
      windSpeed: conditions?.wind_speed ?? null,
      waveHeight: conditions?.wave_height ?? null,
    });

    const indicatorData = await fetchRaceIndicatorData(
      raceId,
      entries.map((e) => ({ boatNumber: e.boat_number, racerId: e.racer_id })),
    );
    const { patterns } = calculateUnifiedScores(
      players,
      turnPrediction,
      indicatorData,
      racerStatsCache,
    );

    for (const p of patterns) {
      firstSamples.push({
        predicted: p.probability ?? 0,
        actual: p.winnerCourse === result.rank1,
      });

      if (p.winnerCourse !== result.rank1) continue; // 1着的中サンプルのみ2着検証
      secondSamples.push({
        predicted: p.secondProbability ?? 0,
        actual: p.second === result.rank2,
      });
      if (p.secondScores?.length > 0) {
        secondRawSamples.push({
          scores: p.secondScores,
          actualNumber: result.rank2,
        });
      }

      if (p.second !== result.rank2) continue; // 1・2着的中サンプルのみ3着検証
      thirdSamples.push({
        predicted: p.thirdProbability ?? 0,
        actual: p.third === result.rank3,
      });
      if (p.thirdScores?.length > 0) {
        thirdRawSamples.push({
          scores: p.thirdScores,
          actualNumber: result.rank3,
        });
      }
    }

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  reportBuckets("1着確率キャリブレーション（turnPrediction）", firstSamples);
  reportBuckets(
    "2着確率キャリブレーション（1着的中サンプルに限定、temp=200デフォルト）",
    secondSamples,
  );
  reportBuckets(
    "3着確率キャリブレーション（1・2着的中サンプルに限定、temp=200デフォルト）",
    thirdSamples,
  );

  gridSearchTemperature("2着確率", secondRawSamples);
  gridSearchTemperature("3着確率", thirdRawSamples);

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
