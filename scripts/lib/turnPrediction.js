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
  VENUE_1COURSE_WIN_RATE,
  VENUE_1COURSE_AVG,
  getVenueType,
} from "./venueParameters.js";
import {
  clamp,
  predictStartTimes,
  stAdvantageMatrix,
  motorZScores,
  playerSkillZScores,
  placementFor,
  boatStrengthsOf,
} from "./turnPredictionBoats.js";
import {
  rawPatterns,
  rankPatterns,
  techniqueDistribution,
} from "./turnPredictionPatterns.js";

// v6: 会場グループ別 upsetFactor 倍率（Phase 2, ADR0011）
// venueParameters.js の VENUE_TYPE（的中率ベース分類）に対応。
// extremeは1コース勝率ベースでは「該当なし」想定だったが、的中率分類では
// 桐生・平和島・鳴門等が該当するため、volatileよりさらに強い倍率を設定する
const UPSET_FACTOR_MULTIPLIER = {
  stable: 1.0,
  volatile: 1.5,
  extreme: 2.0,
};

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
  factor += clamp((venueDiff / 0.1) * 0.4, 0, 0.4);

  // v6: 風速5m以上 → 荒れやすい（Phase 1b, ADR0011）
  // turn-prediction-improvement-roadmap.md: 風速7m+でも実測の逃げ率低下は0-2m比-4.8ptのみで、
  // 旧係数（最大0.3）は実測効果の約5倍の抑制だった。1/4へ縮小（最大0.075）
  if (raceConditions.windSpeed != null && raceConditions.windSpeed >= 5) {
    factor += clamp((raceConditions.windSpeed - 4) * 0.02, 0, 0.075);
  }

  // v6: 波高5cm以上 → 荒れやすい（Phase 1b, ADR0011、風速と同様の理由で1/4へ縮小）
  if (raceConditions.waveHeight != null && raceConditions.waveHeight >= 5) {
    factor += clamp((raceConditions.waveHeight - 4) * 0.015, 0, 0.075);
  }

  // v6: 会場グループ別倍率（Phase 2, ADR0011）
  // 的中率の低い会場（extreme）ほどupsetFactorを強め、非逃げ確率を引き上げる
  const venueType = getVenueType(venueCode);
  factor *= UPSET_FACTOR_MULTIPLIER[venueType];

  return clamp(factor, 0, 1);
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

  // Step 1〜2・Phase 2D・6: ST予測とST優位性、モーター・選手力のZスコア
  const boats = {
    sorted,
    stAdvantage: stAdvantageMatrix(sorted, predictStartTimes(sorted)),
    motorZ: motorZScores(sorted),
    playerSkillZ: playerSkillZScores(sorted),
  };

  // v4: upsetFactor算出（レースコンディションベース）
  const upsetFactor = calcUpsetFactor(raceConditions);
  const venueCode = String(raceConditions?.venueCode || "").padStart(2, "0");

  // Step 3〜5: 統一確率 → 正規化と上位3パターン → 2着3着
  const patterns = rawPatterns({ ...boats, upsetFactor, venueCode });
  const top3 = rankPatterns(patterns);
  for (const pattern of top3)
    Object.assign(pattern, placementFor(pattern, boats));

  return {
    patterns: top3,
    technique: top3[0].technique,
    probability: top3[0].probability,
    winnerCourse: top3[0].winnerCourse,
    distribution: techniqueDistribution(patterns, venueCode),
    boatStrengths: boatStrengthsOf(boats),
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
