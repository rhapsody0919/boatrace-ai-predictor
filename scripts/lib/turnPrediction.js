/**
 * 1マーク展開予測ロジック v5（バックエンド用）
 *
 * v5: キャリブレーション改善（BOA-66分析より）
 *   - 1コース基本勝率を会場別勝率で補正（全国平均55%固定→会場実績値）
 *   - softmax温度 1.3→1.5（高確率帯の過信を抑制）
 *   - まくり・まくり差しにフロア確率を設定（低確率帯の過小評価を緩和）
 *
 * v4: 統一コース勝率フレームワーク + レースコンディション統合
 *   - 逃げ/非逃げを同一スケール（COURSE_BASE_WIN_RATE × techniqueRate）で計算し、逃げバイアスを解消
 *   - 会場特性・気象条件を upsetFactor として取り込み、荒れやすいレースの非逃げ確率を引き上げ
 *
 * 入力: 6艇の選手データ（枠番, 進入コース, 展示ST, 平均ST, 決まり手分布, 被攻撃分布, モーター性能, 選手基本データ）
 *       + raceConditions（会場コード, 風速, 波高）
 * 出力: 上位3パターン + 決まり手確率分布
 */

import {
  COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE,
} from "./winningTechniques.js";
import { getPlacementBaseline } from "./placementDistribution.js";
import { VENUE_1COURSE_WIN_RATE, VENUE_1COURSE_AVG } from "./venueParameters.js";

const DEFAULT_ST = 0.15;

// 正規化時のsoftmax温度パラメータ（T>1で高確率帯の過大評価を抑制）
// v5: 1.3→1.5 に引き上げ（70-80%帯で+14pt過信を緩和しつつ下がりすぎを防ぐ）
const SOFTMAX_TEMP = 1.5;

// v5: まくり・まくり差しの正規化後フロア確率（低確率帯の過小評価を緩和）
// 正規化後に適用し、全体を再正規化して合計100%を維持
const MAKURI_PROB_FLOOR = 0.015;
const MAKURIZASHI_PROB_FLOOR = 0.012;

// コース別の基本勝率（全国平均）
const COURSE_BASE_WIN_RATE = {
  1: 0.55,
  2: 0.15,
  3: 0.12,
  4: 0.1,
  5: 0.06,
  6: 0.04,
};

// Phase 2A: 級別スコア
const GRADE_SCORE = { A1: 1.0, A2: 0.75, B1: 0.45, B2: 0.2 };

// Phase 5B: 決まり手別モーター補正ウェイト
const MOTOR_WEIGHT = {
  nige: 0.04,
  sashi: 0.015,
  makuri: 0.06,
  makurizashi: 0.045,
  nuki: 0.03,
  megumare: 0.01,
};

// Phase 5C: 決まり手別選手力補正ウェイト
const SKILL_WEIGHT = {
  nige: 0.06,
  sashi: 0.1,
  makuri: 0.03,
  makurizashi: 0.06,
  nuki: 0.05,
  megumare: 0.01,
};

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * レースコンディションから upsetFactor を算出（0〜1）
 * 0 = 堅いレース（逃げ有利）、1 = 荒れやすい（非逃げ有利）
 * turnPrediction非依存の要素のみ使用（循環依存回避）
 */
function calcUpsetFactor(raceConditions) {
  if (!raceConditions) return 0;

  let factor = 0;

  // 会場の1コース勝率が低い → 荒れやすい（最大0.4）
  const venueCode = String(raceConditions.venueCode || "").padStart(2, "0");
  const venueWinRate = VENUE_1COURSE_WIN_RATE[venueCode] || VENUE_1COURSE_AVG;
  const venueDiff = VENUE_1COURSE_AVG - venueWinRate;
  factor += clamp(venueDiff / 0.10 * 0.4, 0, 0.4);

  // 風速5m以上 → 荒れやすい（最大0.3）
  if (raceConditions.windSpeed != null && raceConditions.windSpeed >= 5) {
    factor += clamp((raceConditions.windSpeed - 4) * 0.08, 0, 0.3);
  }

  // 波高5cm以上 → 荒れやすい（最大0.3）
  if (raceConditions.waveHeight != null && raceConditions.waveHeight >= 5) {
    factor += clamp((raceConditions.waveHeight - 4) * 0.06, 0, 0.3);
  }

  return clamp(factor, 0, 1);
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

/**
 * 1マーク展開予測 v4
 * @param {Array} players - 6艇の選手データ
 * @param {Object} [raceConditions] - レースコンディション { venueCode, windSpeed, waveHeight }
 */
export function predictFirstMarkV2(players, raceConditions) {
  if (!players || players.length < 6) {
    return getDefaultPrediction();
  }

  // コース順にソート（進入コース or 枠番）
  const sorted = players
    .map((p) => ({
      ...p,
      course: p.course || p.boatNumber,
    }))
    .sort((a, b) => a.course - b.course);

  // Step 1: 各コースのST予測
  const predictedST = sorted.map((p) => {
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

  // Phase 3: ST標準偏差による信頼度
  const stReliability = sorted.map((p) => {
    const sd = p.stStddev || 0.05;
    return Math.max(0.5, 1 - sd * 2);
  });

  // Step 2: ST優位性マトリクス（Phase 3: 信頼度で減衰）
  const stAdvantage = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => {
      const raw = sigmoid((predictedST[j] - predictedST[i]) / 0.03);
      return 0.5 + (raw - 0.5) * stReliability[i];
    }),
  );

  // Phase 6: モーターZスコア（クリッピング付き）
  const motor2Rates = sorted.map((p) => p.motor2Rate || 30);
  const motorAvg = average(motor2Rates);
  const motorStdDev = Math.max(
    1,
    Math.sqrt(
      motor2Rates.reduce((s, v) => s + Math.pow(v - motorAvg, 2), 0) /
        motor2Rates.length,
    ),
  );
  const motorZ = motor2Rates.map((v) =>
    clamp((v - motorAvg) / motorStdDev, -2.0, 2.0),
  );

  // Phase 2D: 選手力Zスコア
  const playerSkills = sorted.map((p) => calcPlayerSkill(p));
  const skillAvg = average(playerSkills);
  const skillStdDev = Math.max(0.01, stddev(playerSkills));
  const playerSkillZ = playerSkills.map((v) =>
    clamp((v - skillAvg) / skillStdDev, -2, 2),
  );

  // v4: upsetFactor算出（レースコンディションベース）
  const upsetFactor = calcUpsetFactor(raceConditions);

  // v5: 会場別1コース勝率でコース基本勝率を補正
  // COURSE_BASE_WIN_RATE は全国平均（1コース=55%）だが、インが強い会場（大村62%等）では
  // 低確率帯の逃げが過小評価されるため、会場実績値にスケールする
  const venueCode = String(raceConditions?.venueCode || "").padStart(2, "0");
  const venue1Rate = VENUE_1COURSE_WIN_RATE[venueCode] || VENUE_1COURSE_AVG;
  const base1Rate = COURSE_BASE_WIN_RATE[1]; // 0.55
  const remainingScale = (1 - venue1Rate) / (1 - base1Rate); // 2-6コースを比例縮小

  function getVenueCourseWinRate(courseInt) {
    if (courseInt === 1) return venue1Rate;
    return (COURSE_BASE_WIN_RATE[courseInt] || 0.05) * remainingScale;
  }

  // Step 3: 全コース・全決まり手の統一確率計算
  const course1 = sorted[0];
  const c1Course = String(course1.course);

  // 1コースの被攻撃分布（非逃げの defense adjustment に使用）
  const c1DefenseDist = course1.defenseDistribution || {};
  const c1DefenseForCourse =
    c1DefenseDist[c1Course] || COURSE_DEFAULT_DEFENSE[1];
  const avgDefenseRate =
    Object.values(c1DefenseForCourse).reduce((s, v) => s + v, 0) /
    Object.keys(c1DefenseForCourse).length;

  const allTechniques = ["nige", "sashi", "makuri", "makurizashi", "nuki", "megumare"];
  const patterns = [];

  for (let cIdx = 0; cIdx < 6; cIdx++) {
    const player = sorted[cIdx];
    const courseNum = String(player.course);
    const courseInt = player.course;

    // コース別基本勝率（v5: 会場別補正済み）
    const courseWinRate = getVenueCourseWinRate(courseInt);

    // 攻撃分布（ベイズ縮小）
    const playerAttackDist = player.attackDistribution || {};
    const playerCourseDist =
      playerAttackDist[courseNum] ||
      COURSE_DEFAULT_DISTRIBUTION[courseInt] ||
      {};
    const playerCourseRaces = player.courseRaceCounts?.[courseNum]?.total || 0;
    const playerBlend = Math.min(1, playerCourseRaces / 20);

    for (const t of allTechniques) {
      // 逃げは1コースのみ（2-6コースの逃げはスキップ）
      if (t === "nige" && courseInt !== 1) continue;

      // ベイズ縮小で決まり手率を算出
      const personalRate = playerCourseDist[t] || 0;
      const defaultRate =
        (COURSE_DEFAULT_DISTRIBUTION[courseInt] || {})[t] || 0;
      const techniqueRate =
        personalRate * playerBlend + defaultRate * (1 - playerBlend);

      if (techniqueRate <= 0.001) continue;

      // 統一ベース確率: コース勝率 × 決まり手率
      let rawProb = courseWinRate * techniqueRate;

      // v4: 非逃げの defense adjustment（1コースの被攻撃脆弱性で補正）
      if (t !== "nige" && avgDefenseRate > 0) {
        const defenseRate = c1DefenseForCourse[t] || 0;
        const defenseAdjust = 0.6 + 0.4 * (defenseRate / avgDefenseRate);
        rawProb *= defenseAdjust;
      }

      // ST補正（決まり手ごとに異なるウェイト）
      if (t === "nige") {
        // 逃げ: 1コースの全5コースに対するST優位性
        const stFactor =
          stAdvantage[0][1] * 0.4 +
          stAdvantage[0][2] * 0.3 +
          stAdvantage[0][3] * 0.2 +
          stAdvantage[0][4] * 0.07 +
          stAdvantage[0][5] * 0.03;
        // stFactor: 0.5 = 同等、>0.5 = 1コース有利
        rawProb *= 0.4 + 1.2 * stFactor;
      } else if (t === "makuri" || t === "makurizashi") {
        rawProb *= 0.3 + 0.7 * stAdvantage[cIdx][0];
      } else if (t === "sashi") {
        rawProb *= 0.7 + 0.3 * stAdvantage[cIdx][0];
      }

      // 決まり手別モーター補正
      rawProb *= 1 + motorZ[cIdx] * (MOTOR_WEIGHT[t] || 0.03);

      // 決まり手別選手力補正
      rawProb *= 1 + playerSkillZ[cIdx] * (SKILL_WEIGHT[t] || 0.05);

      // v4: upsetFactor による逃げ抑制・非逃げ押し上げ
      if (upsetFactor > 0) {
        if (t === "nige") {
          rawProb *= 1 - upsetFactor * 0.25; // 最大25%抑制
        } else {
          rawProb *= 1 + upsetFactor * 0.15; // 最大15%押し上げ
        }
      }

      // megumare のフロア値
      if (t === "megumare") {
        rawProb = Math.max(rawProb, 0.005);
      }

      if (rawProb > 0.001) {
        patterns.push({
          technique: t,
          winnerCourse: courseInt,
          rawProb,
        });
      }
    }
  }

  // Step 5: 正規化 & 上位3パターン選出
  // softmax温度パラメータで高確率帯の過大評価を抑制
  const scaledProbs = patterns.map((p) => Math.pow(p.rawProb, 1 / SOFTMAX_TEMP));
  const totalScaled = scaledProbs.reduce((s, v) => s + v, 0);
  for (let i = 0; i < patterns.length; i++) {
    patterns[i].probability =
      Math.round((scaledProbs[i] / totalScaled) * 100) / 100;
  }

  patterns.sort((a, b) => b.probability - a.probability);

  const top3 = patterns
    .slice(0, 3)
    .map(({ technique, winnerCourse, probability }) => ({
      technique,
      winnerCourse,
      probability,
    }));

  // Phase 7: 2着3着予測（playerSkillZで置換、上限1.5に緩和）
  for (const pattern of top3) {
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

      // 他コース（勝者・自分除く）との平均ST優位性
      const otherIndices = [];
      for (let j = 0; j < 6; j++) {
        if (j !== cIdx && sorted[j].course !== pattern.winnerCourse) {
          otherIndices.push(j);
        }
      }
      const avgStAdv =
        otherIndices.length > 0
          ? otherIndices.reduce((s, j) => s + stAdvantage[cIdx][j], 0) /
            otherIndices.length
          : 0.5;

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

    // 正規化（勝者コース除外、残り5コースで合計1.0）
    const sumS = Object.values(secondPlace).reduce((a, b) => a + b, 0);
    const sumT = Object.values(thirdPlace).reduce((a, b) => a + b, 0);

    for (const c of Object.keys(secondPlace)) {
      secondPlace[c] =
        sumS > 0 ? Math.round((secondPlace[c] / sumS) * 100) / 100 : 0;
    }
    for (const c of Object.keys(thirdPlace)) {
      thirdPlace[c] =
        sumT > 0 ? Math.round((thirdPlace[c] / sumT) * 100) / 100 : 0;
    }

    pattern.secondPlace = secondPlace;
    pattern.thirdPlace = thirdPlace;
  }

  // 全体の分布（決まり手ごとに合算）
  const distribution = {};
  for (const p of patterns) {
    distribution[p.technique] =
      (distribution[p.technique] || 0) + p.probability;
  }

  // v5: まくり・まくり差しのフロア確率を正規化後に適用
  // 過小評価された低確率帯を底上げし、全体を再正規化して合計100%を維持
  for (const [tech, floor] of [["makuri", MAKURI_PROB_FLOOR], ["makurizashi", MAKURIZASHI_PROB_FLOOR]]) {
    if ((distribution[tech] || 0) < floor) {
      distribution[tech] = floor;
    }
  }
  const distTotal = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (distTotal > 1.001) {
    for (const key of Object.keys(distribution)) {
      distribution[key] /= distTotal;
    }
  }

  for (const key of Object.keys(distribution)) {
    distribution[key] = Math.round(distribution[key] * 100) / 100;
  }

  // Phase 8: boatStrengths 再設計（展示タイム・選手力を含む4要素）
  const exTimes = sorted.map((p) => p.exhibitionTime || null);
  const validExTimes = exTimes.filter((t) => t != null);
  const hasExhibition = validExTimes.length >= 4;

  let exZ = Array(6).fill(0);
  if (hasExhibition) {
    const exAvg = average(validExTimes);
    const exStd = Math.max(0.01, stddev(validExTimes));
    exZ = exTimes.map((t) =>
      t != null ? clamp(-(t - exAvg) / exStd, -2, 2) : 0,
    );
  }

  const boatStrengths = sorted.map((_, i) => {
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

  return {
    patterns: top3,
    technique: top3[0].technique,
    probability: top3[0].probability,
    winnerCourse: top3[0].winnerCourse,
    distribution,
    boatStrengths,
  };
}

// 旧API互換のラッパー
export function predictFirstMark(players, raceConditions) {
  return predictFirstMarkV2(players, raceConditions);
}

/**
 * データ不足時のデフォルト予測
 */
function getDefaultPrediction() {
  return {
    patterns: [
      {
        technique: "nige",
        winnerCourse: 1,
        probability: 0.55,
        secondPlace: { 2: 0.33, 3: 0.29, 4: 0.19, 5: 0.12, 6: 0.07 },
        thirdPlace: { 2: 0.22, 3: 0.24, 4: 0.22, 5: 0.17, 6: 0.15 },
      },
      {
        technique: "sashi",
        winnerCourse: 2,
        probability: 0.15,
        secondPlace: { 1: 0.62, 3: 0.17, 4: 0.1, 5: 0.06, 6: 0.05 },
        thirdPlace: { 1: 0.19, 3: 0.26, 4: 0.23, 5: 0.17, 6: 0.15 },
      },
      {
        technique: "makuri",
        winnerCourse: 3,
        probability: 0.13,
        secondPlace: { 1: 0.19, 2: 0.24, 4: 0.26, 5: 0.21, 6: 0.1 },
        thirdPlace: { 1: 0.17, 2: 0.22, 4: 0.21, 5: 0.21, 6: 0.19 },
      },
    ],
    technique: "nige",
    probability: 0.55,
    winnerCourse: 1,
    distribution: {
      nige: 0.55,
      sashi: 0.15,
      makuri: 0.13,
      makurizashi: 0.1,
      nuki: 0.05,
      megumare: 0.02,
    },
    boatStrengths: [0.55, 0.52, 0.5, 0.48, 0.46, 0.44],
  };
}
