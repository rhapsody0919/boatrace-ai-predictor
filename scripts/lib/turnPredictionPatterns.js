/**
 * 1マーク展開予測（turnPrediction.js）の決着パターン。
 * 全コース・全決まり手の統一確率（v4）→ softmax 正規化と上位3パターン → 決まり手の分布（フロア・再正規化）
 */

import {
  COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE,
} from "./winningTechniques.js";
import {
  VENUE_1COURSE_WIN_RATE,
  VENUE_1COURSE_AVG,
  getVenueType,
} from "./venueParameters.js";

// 正規化時のsoftmax温度パラメータ（T>1で高確率帯の過大評価を抑制）
// v5: 1.3→1.5 に引き上げ（70-80%帯で+14pt過信を緩和しつつ下がりすぎを防ぐ）
const SOFTMAX_TEMP = 1.5;

// v5: まくり・まくり差しの正規化後フロア確率（低確率帯の過小評価を緩和）
// 正規化後に適用し、全体を再正規化して合計100%を維持
const MAKURI_PROB_FLOOR = 0.015;
const MAKURIZASHI_PROB_FLOOR = 0.012;

// v6: 逃げ確率のキャリブレーション補正係数（Phase 1a, ADR0011）
// scripts/analysis/simulate-nige-calibration.js で1.0〜2.0を検証し、k=1.5を採用
const NIGE_CALIBRATION_FACTOR = 1.5;

// v6: 会場グループ別 まくり・まくり差しフロア確率（Phase 2, ADR0011）
// 低精度会場（extreme）ほど「まくり」「まくり差し」の予測数が実績より過小
// （turn-prediction-improvement-roadmap.md: 低精度会場で非1コース決着が3割以上、
// モデルが外郭艇の台頭を捉えられていない）ため、フロア値を段階的に引き上げる
const TECHNIQUE_FLOOR_BY_VENUE = {
  stable: { makuri: MAKURI_PROB_FLOOR, makurizashi: MAKURIZASHI_PROB_FLOOR },
  volatile: { makuri: 0.04, makurizashi: 0.03 },
  extreme: { makuri: 0.06, makurizashi: 0.04 },
};

// コース別の基本勝率（全国平均）
const COURSE_BASE_WIN_RATE = {
  1: 0.55,
  2: 0.15,
  3: 0.12,
  4: 0.1,
  5: 0.06,
  6: 0.04,
};

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

const ALL_TECHNIQUES = [
  "nige",
  "sashi",
  "makuri",
  "makurizashi",
  "nuki",
  "megumare",
];

/**
 * v5: 会場別1コース勝率でコース基本勝率を補正
 * COURSE_BASE_WIN_RATE は全国平均（1コース=55%）だが、インが強い会場（大村62%等）では
 * 低確率帯の逃げが過小評価されるため、会場実績値にスケールする
 */
function venueCourseWinRate(venueCode) {
  const venue1Rate = VENUE_1COURSE_WIN_RATE[venueCode] || VENUE_1COURSE_AVG;
  const base1Rate = COURSE_BASE_WIN_RATE[1]; // 0.55
  const remainingScale = (1 - venue1Rate) / (1 - base1Rate); // 2-6コースを比例縮小
  return (courseInt) =>
    courseInt === 1
      ? venue1Rate
      : (COURSE_BASE_WIN_RATE[courseInt] || 0.05) * remainingScale;
}

/** 1コースの被攻撃分布（非逃げの defense adjustment に使用） */
function course1Defense(course1) {
  const c1DefenseDist = course1.defenseDistribution || {};
  const c1DefenseForCourse =
    c1DefenseDist[String(course1.course)] || COURSE_DEFAULT_DEFENSE[1];
  const avgDefenseRate =
    Object.values(c1DefenseForCourse).reduce((s, v) => s + v, 0) /
    Object.keys(c1DefenseForCourse).length;
  return { c1DefenseForCourse, avgDefenseRate };
}

/** 攻撃分布（ベイズ縮小）で決まり手率を返す関数 */
function techniqueRateOf(player) {
  const courseNum = String(player.course);
  const courseInt = player.course;
  const playerAttackDist = player.attackDistribution || {};
  const playerCourseDist =
    playerAttackDist[courseNum] || COURSE_DEFAULT_DISTRIBUTION[courseInt] || {};
  const playerCourseRaces = player.courseRaceCounts?.[courseNum]?.total || 0;
  const playerBlend = Math.min(1, playerCourseRaces / 20);
  return (t) => {
    const personalRate = playerCourseDist[t] || 0;
    const defaultRate = (COURSE_DEFAULT_DISTRIBUTION[courseInt] || {})[t] || 0;
    return personalRate * playerBlend + defaultRate * (1 - playerBlend);
  };
}

/** ST補正（決まり手ごとに異なるウェイト）。補正しない決まり手は 1 */
function stMultiplier(t, cIdx, stAdvantage) {
  if (t === "nige") {
    // 逃げ: 1コースの全5コースに対するST優位性
    const stFactor =
      stAdvantage[0][1] * 0.4 +
      stAdvantage[0][2] * 0.3 +
      stAdvantage[0][3] * 0.2 +
      stAdvantage[0][4] * 0.07 +
      stAdvantage[0][5] * 0.03;
    // stFactor: 0.5 = 同等、>0.5 = 1コース有利
    return 0.4 + 1.2 * stFactor;
  }
  if (t === "makuri" || t === "makurizashi") {
    return 0.3 + 0.7 * stAdvantage[cIdx][0];
  }
  if (t === "sashi") return 0.7 + 0.3 * stAdvantage[cIdx][0];
  return 1;
}

/** 決まり手 t・コース cIdx の生の確率（統一ベース確率に補正を順に掛ける） */
function techniqueRawProb(t, cIdx, base, ctx) {
  const { stAdvantage, motorZ, playerSkillZ, upsetFactor, defense } = ctx;
  // 統一ベース確率: コース勝率 × 決まり手率
  let rawProb = base;

  // v4: 非逃げの defense adjustment（1コースの被攻撃脆弱性で補正）
  if (t !== "nige" && defense.avgDefenseRate > 0) {
    const defenseRate = defense.c1DefenseForCourse[t] || 0;
    rawProb *= 0.6 + 0.4 * (defenseRate / defense.avgDefenseRate);
  }

  if (t === "nige" || t === "makuri" || t === "makurizashi" || t === "sashi") {
    rawProb *= stMultiplier(t, cIdx, stAdvantage);
  }

  // 決まり手別モーター補正・選手力補正
  rawProb *= 1 + motorZ[cIdx] * (MOTOR_WEIGHT[t] || 0.03);
  rawProb *= 1 + playerSkillZ[cIdx] * (SKILL_WEIGHT[t] || 0.05);

  // v6: 逃げ確率のキャリブレーション補正（Phase 1a, ADR0011）
  // calibration-report.js（2026-08-11実行）で全確率帯において逃げの予測確率が
  // 実現率より系統的に低い（乖離12.8〜18.3pt、過小評価）ことを確認。
  // scripts/analysis/simulate-nige-calibration.js でrawProbへの補正係数kを
  // 1.0〜2.0の範囲で試した結果、k=1.5でサンプル数加重平均乖離が12.3pt→8.3ptに縮小
  // （k=2.0でさらに縮小するが60%+帯の乖離が変わらず過学習の懸念があるため保守的な値を採用）
  if (t === "nige") rawProb *= NIGE_CALIBRATION_FACTOR;

  // v4: upsetFactor による逃げ抑制（最大25%）・非逃げ押し上げ（最大15%）
  if (upsetFactor > 0) {
    rawProb *= t === "nige" ? 1 - upsetFactor * 0.25 : 1 + upsetFactor * 0.15;
  }

  // megumare のフロア値
  if (t === "megumare") rawProb = Math.max(rawProb, 0.005);
  return rawProb;
}

/**
 * Step 3: 全コース・全決まり手の統一確率計算
 * @param {Object} ctx - { sorted, stAdvantage, motorZ, playerSkillZ, upsetFactor, venueCode }
 * @returns {Array<{technique, winnerCourse, rawProb}>}
 */
export function rawPatterns(ctx) {
  const courseWinRateOf = venueCourseWinRate(ctx.venueCode);
  const full = { ...ctx, defense: course1Defense(ctx.sorted[0]) };
  const patterns = [];

  for (let cIdx = 0; cIdx < 6; cIdx++) {
    const courseInt = ctx.sorted[cIdx].course;
    // コース別基本勝率（v5: 会場別補正済み）
    const courseWinRate = courseWinRateOf(courseInt);
    const rateOf = techniqueRateOf(ctx.sorted[cIdx]);

    for (const t of ALL_TECHNIQUES) {
      // 逃げは1コースのみ（2-6コースの逃げはスキップ）
      if (t === "nige" && courseInt !== 1) continue;
      const techniqueRate = rateOf(t);
      if (techniqueRate <= 0.001) continue;
      const base = courseWinRate * techniqueRate;
      const rawProb = techniqueRawProb(t, cIdx, base, full);
      if (rawProb > 0.001) {
        patterns.push({ technique: t, winnerCourse: courseInt, rawProb });
      }
    }
  }
  return patterns;
}

/**
 * Step 5: 正規化 & 上位3パターン選出（patterns に probability を書き、確率の高い順に並べ替える）
 * softmax温度パラメータで高確率帯の過大評価を抑制
 */
export function rankPatterns(patterns) {
  const scaledProbs = patterns.map((p) =>
    Math.pow(p.rawProb, 1 / SOFTMAX_TEMP),
  );
  const totalScaled = scaledProbs.reduce((s, v) => s + v, 0);
  for (let i = 0; i < patterns.length; i++) {
    patterns[i].probability =
      Math.round((scaledProbs[i] / totalScaled) * 100) / 100;
  }

  patterns.sort((a, b) => b.probability - a.probability);

  return patterns
    .slice(0, 3)
    .map(({ technique, winnerCourse, probability }) => ({
      technique,
      winnerCourse,
      probability,
    }));
}

/**
 * 全体の分布（決まり手ごとに合算）
 * v5/v6: まくり・まくり差しのフロア確率を正規化後に適用（Phase2で会場グループ別に変更、ADR0011）
 * 過小評価された低確率帯を底上げし、全体を再正規化して合計100%を維持
 */
export function techniqueDistribution(patterns, venueCode) {
  const distribution = {};
  for (const p of patterns) {
    distribution[p.technique] =
      (distribution[p.technique] || 0) + p.probability;
  }

  const floorByVenue =
    TECHNIQUE_FLOOR_BY_VENUE[getVenueType(venueCode)] ||
    TECHNIQUE_FLOOR_BY_VENUE.volatile;
  for (const [tech, floor] of [
    ["makuri", floorByVenue.makuri],
    ["makurizashi", floorByVenue.makurizashi],
  ]) {
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
  return distribution;
}
