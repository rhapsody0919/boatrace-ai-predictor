// unified の日次予測（generate-unified-predictions.js）の1レース分の行を作る純関数。DB・ファイル・ネットワークに触れない。
// generate-unified-predictions.js の越え（generateUnifiedPredictions）を分けた（中身は元のまま）
import { computeInCaution } from "./inCaution.js";
import { predictFirstMark } from "./turnPrediction.js";
import {
  calculateVolatilityComposite,
  toVolatilityPercentile,
} from "./volatilityFactors.js";

const FALLBACK_PERCENTILE = 0.5; // 分布データが不足する場合のフォールバック（運用開始直後）
const MIN_DISTRIBUTION_SAMPLES = 20; // これ未満ならフォールバックを使う

/**
 * FR1複勝予想: コース別勝率が高い上位2艇を選出する（EV計算不要、backtest-course-rate-only.jsと同じロジック）
 */
// コース別勝率のサンプル数がこれ未満の場合は判定不能として除外する
// （2026-08-14修正、BOA-190。total:1/wins:1のような極少サンプルが勝率100%として
// 実績豊富な選手を押しのけて1位表示されるのを防ぐ）
const MIN_COURSE_SAMPLES = 5;

export function calculatePlaceRecommendation(entries, racerStatsMap) {
  const courseRates = entries.map((e) => {
    const stats = racerStatsMap.get(e.racer_id);
    const counts = stats?.course_race_counts?.[String(e.boat_number)];
    const rate =
      counts?.total >= MIN_COURSE_SAMPLES
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
 * 1レース分の predictions の行（model_id=modelId、is_shadow=false）。
 * ctx: { modelId, racerStatsMap, volatilityDistByVenue, inCautionRates }
 */
export function buildUnifiedPredictionRow(
  race,
  { modelId, racerStatsMap, volatilityDistByVenue, inCautionRates },
) {
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
  const volatilityPercentileIsFallback =
    dist.length < MIN_DISTRIBUTION_SAMPLES;
  const volatilityPercentile = volatilityPercentileIsFallback
    ? FALLBACK_PERCENTILE
    : toVolatilityPercentile(volatility.composite, dist);

  const { inCaution, skip: inCautionSkip } = computeInCaution({
    entries: race.entries,
    raceStage: race.raceStage,
    rates: inCautionRates,
  });

  return {
    race_id: race.raceId,
    model_id: modelId,
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
      // フォールバック値0.5は「標準」に見えてしまい実態と異なるため、フロント側で
      // 「データ収集中」表示に切り替えられるようフラグを持たせる（2026-08-14ユーザー指摘）
      volatilityPercentileIsFallback,
      volatilityReasons: volatility.reasons,
      inCaution,
      inCautionSkip,
    },
  };
}
