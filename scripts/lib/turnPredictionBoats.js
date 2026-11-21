/**
 * 1マーク展開予測（turnPrediction.js）の艇ごとの特徴。
 * ST予測・ST優位性マトリクス・モーター／選手力のZスコア・2着3着の分布・boatStrengths
 */

import { getPlacementBaseline } from "./placementDistribution.js";

const DEFAULT_ST = 0.15;

// Phase 2A: 級別スコア
const GRADE_SCORE = { A1: 1.0, A2: 0.75, B1: 0.45, B2: 0.2 };

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function average(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  const avg = average(arr);
  return Math.sqrt(
    arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length,
  );
}

// Phase 2B: 当地勝率のベイズ縮小
function blendLocalRate(localRate, globalRate, courseRaceCounts) {
  const totalRaces = Object.values(courseRaceCounts || {}).reduce(
    (s, c) => s + (c.total || 0),
    0,
  );
  const blend = Math.min(1, totalRaces / 30);
  return (localRate || globalRate) * blend + (globalRate || 5.0) * (1 - blend);
}

// Phase 2C: 選手力スコア算出
function calcPlayerSkill(p) {
  const gradeScore = GRADE_SCORE[p.grade] || 0.45;
  const winRateScore = Math.min(1, (p.globalWinRate || 5.0) / 8.0);
  const localRate = blendLocalRate(
    p.localWinRate,
    p.globalWinRate,
    p.courseRaceCounts,
  );
  const localScore = Math.min(1, localRate / 8.0);
  const rate2Score = Math.min(1, (p.global2Rate || 25) / 50);

  return (
    winRateScore * 0.35 +
    localScore * 0.25 +
    rate2Score * 0.25 +
    gradeScore * 0.15
  );
}

/** Step 1: 各コースのST予測（コース順の艇） */
export function predictStartTimes(sorted) {
  return sorted.map((p) => {
    const exST = p.exhibitionST;
    const avgST = p.avgST;

    if (exST != null && avgST != null) {
      return exST * 0.55 + avgST * 0.35 + DEFAULT_ST * 0.1;
    } else if (exST != null) {
      return exST * 0.8 + DEFAULT_ST * 0.2;
    } else if (avgST != null) {
      return avgST * 0.8 + DEFAULT_ST * 0.2;
    }
    return DEFAULT_ST;
  });
}

/** Step 2: ST優位性マトリクス（Phase 3: ST標準偏差による信頼度で減衰） */
export function stAdvantageMatrix(sorted, predictedST) {
  const stReliability = sorted.map((p) => {
    const sd = p.stStddev || 0.05;
    return Math.max(0.5, 1 - sd * 2);
  });
  return Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => {
      const raw = sigmoid((predictedST[j] - predictedST[i]) / 0.03);
      return 0.5 + (raw - 0.5) * stReliability[i];
    }),
  );
}

/** Phase 6: モーターZスコア（クリッピング付き） */
export function motorZScores(sorted) {
  const motor2Rates = sorted.map((p) => p.motor2Rate || 30);
  const motorAvg = average(motor2Rates);
  const motorStdDev = Math.max(
    1,
    Math.sqrt(
      motor2Rates.reduce((s, v) => s + Math.pow(v - motorAvg, 2), 0) /
        motor2Rates.length,
    ),
  );
  return motor2Rates.map((v) => clamp((v - motorAvg) / motorStdDev, -2.0, 2.0));
}

/** Phase 2D: 選手力Zスコア */
export function playerSkillZScores(sorted) {
  const playerSkills = sorted.map((p) => calcPlayerSkill(p));
  const skillAvg = average(playerSkills);
  const skillStdDev = Math.max(0.01, stddev(playerSkills));
  return playerSkills.map((v) => clamp((v - skillAvg) / skillStdDev, -2, 2));
}

/** 他コース（勝者・自分除く）との平均ST優位性 */
function avgStAdvantageExcept(cIdx, winnerCourse, { sorted, stAdvantage }) {
  const otherIndices = [];
  for (let j = 0; j < 6; j++) {
    if (j !== cIdx && sorted[j].course !== winnerCourse) {
      otherIndices.push(j);
    }
  }
  return otherIndices.length > 0
    ? otherIndices.reduce((s, j) => s + stAdvantage[cIdx][j], 0) /
        otherIndices.length
    : 0.5;
}

/** 勝者コース除外、残り5コースで合計1.0に正規化（小数2桁） */
function normalizePlaces(places) {
  const sum = Object.values(places).reduce((a, b) => a + b, 0);
  for (const c of Object.keys(places)) {
    places[c] = sum > 0 ? Math.round((places[c] / sum) * 100) / 100 : 0;
  }
  return places;
}

/**
 * Phase 7: 2着3着予測（playerSkillZで置換、上限1.5に緩和）
 * @returns {{ secondPlace: Object, thirdPlace: Object }}
 */
export function placementFor(pattern, boats) {
  const { sorted, motorZ, playerSkillZ } = boats;
  const baseline = getPlacementBaseline(
    pattern.technique,
    pattern.winnerCourse,
  );
  const secondPlace = {};
  const thirdPlace = {};

  for (let c = 1; c <= 6; c++) {
    if (c === pattern.winnerCourse) continue;
    const cIdx = sorted.findIndex((p) => p.course === c);
    if (cIdx < 0) continue;

    const avgStAdv = avgStAdvantageExcept(cIdx, pattern.winnerCourse, boats);
    // Phase 7A/7B: playerSkillZで置換、上限1.5
    const multiplier = Math.min(
      1.5,
      (1 + 0.12 * (avgStAdv - 0.5) * 2) *
        (1 + 0.08 * motorZ[cIdx]) *
        (1 + 0.06 * playerSkillZ[cIdx]),
    );
    secondPlace[c] = (baseline.second[c] || 0) * Math.max(0.1, multiplier);
    thirdPlace[c] = (baseline.third[c] || 0) * Math.max(0.1, multiplier);
  }

  return {
    secondPlace: normalizePlaces(secondPlace),
    thirdPlace: normalizePlaces(thirdPlace),
  };
}

/** Phase 8: 展示タイムのZスコア（4艇以上に展示タイムがあるときだけ） */
function exhibitionZ(sorted) {
  const exTimes = sorted.map((p) => p.exhibitionTime || null);
  const validExTimes = exTimes.filter((t) => t != null);
  const hasExhibition = validExTimes.length >= 4;
  if (!hasExhibition) return { hasExhibition, exZ: Array(6).fill(0) };
  const exAvg = average(validExTimes);
  const exStd = Math.max(0.01, stddev(validExTimes));
  const exZ = exTimes.map((t) =>
    t != null ? clamp(-(t - exAvg) / exStd, -2, 2) : 0,
  );
  return { hasExhibition, exZ };
}

/** Phase 8: boatStrengths 再設計（展示タイム・選手力を含む4要素） */
export function boatStrengthsOf({ sorted, stAdvantage, motorZ, playerSkillZ }) {
  const { hasExhibition, exZ } = exhibitionZ(sorted);
  return sorted.map((_, i) => {
    const avgStAdv =
      [0, 1, 2, 3, 4, 5]
        .filter((j) => j !== i)
        .reduce((s, j) => s + stAdvantage[i][j], 0) / 5;
    const motorScore = clamp(motorZ[i] * 0.1 + 0.5, 0, 1);
    const playerScore = clamp(playerSkillZ[i] * 0.1 + 0.5, 0, 1);
    const exScore = clamp(exZ[i] * 0.1 + 0.5, 0, 1);

    if (hasExhibition) {
      return (
        avgStAdv * 0.35 + motorScore * 0.2 + playerScore * 0.25 + exScore * 0.2
      );
    }
    return avgStAdv * 0.45 + motorScore * 0.3 + playerScore * 0.25;
  });
}
