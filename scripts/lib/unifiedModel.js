/**
 * 新AI予想モデル「unified」のスコアリング本体（AI予想モデル大規模改修 Task6b/Task8, ADR0009, FR1/FR2/FR6）
 *
 * 設計方針（ADR0009: 統計的ヒューリスティック採用）:
 * - データ出走表11指標を評価し、艇別AIスコアを算出する
 * - 1マーク展開パターン（turnPrediction.js、最大3パターン）ごとに1着艇を固定し、
 *   残り5艇のAIスコア順位で2着・3着を決める（各パターンで異なる着順候補を生成、FR2）
 * - 各艇のスコア内訳から寄与度上位2〜3因子を根拠バッジとして返す（FR6）
 *
 * v3（2026-08-12 Task8根本修正）: 「生値×固定係数の加算」方式（v1/v2）から
 * 「比較対象グループ内でのZスコア化 × 予測力ベースの重み」方式に変更した。
 * scripts/analysis/analyze-indicator-predictive-power.js で11指標それぞれの予測力
 * （2着艇のレース内順位分布、1000レース分）を検証した結果、v1/v2のWEIGHTSは実際の
 * 予測力と逆相関する指標があった（例: courseRateは予測力最強[上位2位計61.8%]なのに
 * 係数はほぼ最小、formは予測力最弱[41.1%、ほぼランダム]なのに係数は最大級）。
 * 値のレンジが指標ごとに大きく異なる（勝率0-10 / モーター0-100% / ST0.05-0.3秒等）ため
 * 生値に固定係数を掛ける方式では正しい重み付けが困難と判断し、Zスコア化に変更した。
 */

import { toTechniqueKey } from "./winningTechniques.js";

// 指標定義: レース内順位分析（analyze-indicator-predictive-power.js、2026-08-12、1000レース）の
// 「上位2位計%」から40%（ランダム基準）を引いた超過予測力を重みとして採用
//   courseRate 61.8% / winRate 57.8% / returnRate 55.5% / localWinRate 52.5% / avgSt 51.4% /
//   exhibitionTime 49.3% / stDeviation 44.7% / exhibitionSt 44.3% / motor 42.1% / form 41.1%
const INDICATOR_WEIGHTS = {
  courseRate: 21.8,
  winRate: 17.8,
  returnRate: 15.5,
  localWinRate: 12.5,
  avgSt: 11.4,
  exhibitionTime: 9.3,
  stDeviation: 4.7,
  exhibitionSt: 4.3,
  motor: 2.1,
  form: 1.1,
};

// 値が大きいほど良い指標か（false=小さいほど良い、STやタイム系）
const HIGHER_IS_BETTER = {
  winRate: true,
  localWinRate: true,
  motor: true,
  form: true,
  avgSt: false,
  stDeviation: false,
  exhibitionSt: false,
  exhibitionTime: false,
  courseRate: true,
  returnRate: true,
};

// 決まり手一致ボーナス（予測力分析の対象外、バイナリ値のためZスコア化しない）。
// 他指標のZスコア×重み寄与（おおむね-2〜2 × 2〜22）とスケールを揃えた控えめな値
const TECHNIQUE_MATCH_WEIGHT = 15;

function byBoat(rows, boatKey = "boat_number") {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row[boatKey], row));
  return map;
}

function reasonText(key, value) {
  switch (key) {
    case "winRate":
      return `全国勝率${value.toFixed(2)}`;
    case "localWinRate":
      return `当地勝率${value.toFixed(2)}`;
    case "motor":
      return `モーター2連率${value.toFixed(0)}%`;
    case "form":
      return value > 0
        ? `調子上昇（+${value.toFixed(2)}）`
        : `調子下降（${value.toFixed(2)}）`;
    case "avgSt":
      return `平均ST${value.toFixed(2)}秒`;
    case "stDeviation":
      return `STのブレ±${value.toFixed(2)}秒`;
    case "exhibitionSt":
      return `展示ST${value.toFixed(2)}秒`;
    case "exhibitionTime":
      return `展示タイム${value.toFixed(2)}秒`;
    case "courseRate":
      return `コース勝率${value.toFixed(0)}%`;
    case "returnRate":
      return `回収率${value.toFixed(0)}%`;
    default:
      return `${key}:${value}`;
  }
}

/** 艇ごとの生値を取得する（指標key -> [{number, value}]） */
function extractIndicatorValues(playerGroup, ctx) {
  const values = {};
  values.winRate = playerGroup.map((p) => ({
    number: p.number,
    value: parseFloat(p.winRate),
  }));
  values.localWinRate = playerGroup.map((p) => ({
    number: p.number,
    value: parseFloat(p.localWinRate),
  }));
  values.motor = playerGroup.map((p) => ({
    number: p.number,
    value: parseFloat(p.motor2Rate),
  }));
  values.form = playerGroup.map((p) => ({
    number: p.number,
    value: ctx.racerFormByBoat.get(p.number)?.delta ?? null,
  }));
  values.avgSt = playerGroup.map((p) => ({
    number: p.number,
    value: ctx.racerStatsMap?.get(p.racerId)?.avg_st ?? null,
  }));
  values.stDeviation = playerGroup.map((p) => {
    const row = ctx.stPredictabilityByBoat.get(p.number);
    return {
      number: p.number,
      value: row?.sample_count > 0 ? row.avg_deviation : null,
    };
  });
  values.exhibitionSt = playerGroup.map((p) => ({
    number: p.number,
    value: ctx.stPredictabilityByBoat.get(p.number)?.exhibition_st ?? null,
  }));
  values.exhibitionTime = playerGroup.map((p) => {
    const row = ctx.exhibitionByBoat.get(p.number);
    return {
      number: p.number,
      value: row?.exhibition_time ?? row?.avg_exhibition_time ?? null,
    };
  });
  values.courseRate = playerGroup.map((p) => {
    const stats = ctx.racerStatsMap?.get(p.racerId);
    const course = p.course ?? p.number;
    const counts = stats?.course_race_counts?.[String(course)];
    return {
      number: p.number,
      value: counts?.total ? ((counts.wins ?? 0) / counts.total) * 100 : null,
    };
  });
  values.returnRate = playerGroup.map((p) => {
    const row = ctx.returnRateByBoat.get(p.number);
    return {
      number: p.number,
      value: row?.sample_count > 0 ? row.win_return_rate : null,
    };
  });
  return values;
}

/**
 * 艇群（通常5艇）内で指標値をZスコア化する。比較対象が2艇未満なら空Mapを返す
 * （Zスコアの分母である標準偏差が意味を持たないため）。
 */
function zScoreMap(values, higherIsBetter) {
  const valid = values.filter(
    (v) => v.value != null && Number.isFinite(v.value),
  );
  if (valid.length < 2) return new Map();
  const mean = valid.reduce((s, v) => s + v.value, 0) / valid.length;
  const variance =
    valid.reduce((s, v) => s + (v.value - mean) ** 2, 0) / valid.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return new Map(valid.map((v) => [v.number, 0]));
  const sign = higherIsBetter ? 1 : -1;
  return new Map(
    valid.map((v) => [v.number, (sign * (v.value - mean)) / stddev]),
  );
}

/**
 * 艇群のAIスコア・根拠バッジをZスコアベースで算出する。
 * @param {Array} playerGroup - 比較対象の艇配列
 * @param {Object} ctx - 指標データMap群 + patternTechnique + racerStatsMap
 * @returns {Array<{number, score, reasons}>}
 */
function calculateGroupScores(playerGroup, ctx) {
  const rawValues = extractIndicatorValues(playerGroup, ctx);
  const zByIndicator = {};
  for (const key of Object.keys(INDICATOR_WEIGHTS)) {
    zByIndicator[key] = zScoreMap(rawValues[key], HIGHER_IS_BETTER[key]);
  }

  return playerGroup.map((p) => {
    const factors = [];
    let score = 0;

    for (const key of Object.keys(INDICATOR_WEIGHTS)) {
      const z = zByIndicator[key].get(p.number);
      if (z == null) continue;
      const contribution = z * INDICATOR_WEIGHTS[key];
      score += contribution;
      const rawValue = rawValues[key].find((v) => v.number === p.number)?.value;
      if (Math.abs(contribution) > 0.01 && rawValue != null) {
        factors.push({ contribution, reason: reasonText(key, rawValue) });
      }
    }

    const techRow = ctx.techniqueByBoat.get(p.number);
    if (techRow?.techniques?.length > 0 && ctx.patternTechnique) {
      const top = techRow.techniques[0];
      const techKey = toTechniqueKey(top.technique);
      if (techKey === ctx.patternTechnique) {
        const matchStrength = (top.percentage ?? 0) / 100;
        const contribution = matchStrength * TECHNIQUE_MATCH_WEIGHT;
        score += contribution;
        factors.push({
          contribution,
          reason: `${top.technique}が得意（勝利の${(top.percentage ?? 0).toFixed(0)}%）`,
        });
      }
    }

    const reasons = factors
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 3)
      .map((f) => f.reason);

    return { number: p.number, score, reasons };
  });
}

/**
 * 展開パターンごとに艇別AIスコア・根拠バッジ・1-2-3着候補を算出する。
 * @param {Array} players - 6艇（{ number, course, racerId, winRate, localWinRate, motor2Rate, grade }）
 * @param {Object} turnPrediction - predictFirstMark() の出力（patterns配列、最大3）
 * @param {Object} indicatorData - fetchRaceIndicatorData() の出力
 * @param {Map} racerStatsMap - racerId -> { avg_st, course_race_counts, ... }（racer_aggregated_stats）
 * @returns {{ boatScores: Array, patterns: Array }}
 *   boatScores: 艇ごとのAIスコア・根拠バッジ（6艇内でZスコア化、表示用）
 *   patterns: 各展開パターンについて
 *     { technique, winnerCourse, probability(1着確率), first, second, third,
 *       secondProbability, thirdProbability, combinedProbability(3連単同時確率=1着×2着×3着) }
 */
export function calculateUnifiedScores(
  players,
  turnPrediction,
  indicatorData,
  racerStatsMap,
  options = {},
) {
  const softmaxTemp = options.softmaxTemp ?? SCORE_SOFTMAX_TEMP;
  const ctx = {
    racerFormByBoat: byBoat(indicatorData?.racerForm, "boatNumber"),
    stPredictabilityByBoat: byBoat(indicatorData?.stPredictability),
    exhibitionByBoat: byBoat(indicatorData?.exhibitionTrend),
    returnRateByBoat: byBoat(indicatorData?.returnRate),
    techniqueByBoat: byBoat(indicatorData?.techniqueProfile),
    racerStatsMap,
    patternTechnique: null, // パターンごとに設定
  };

  // 表示用の艇別AIスコア（データ出走表のAI予想行、FR6）は6艇全体でZスコア化し、
  // 最有力パターン（patterns[0]）の決まり手を基準に算出する
  const primaryTechnique = turnPrediction?.patterns?.[0]?.technique ?? null;
  const primaryCtx = { ...ctx, patternTechnique: primaryTechnique };
  const boatScores = calculateGroupScores(players, primaryCtx);

  // 展開パターンごとの1-2-3着候補（FR2、FR5の土台）
  // 1着確率 × P(2着|1着) × P(3着|1着,2着) の同時確率を算出する（v2の根本修正を継承）
  const patternResults = (turnPrediction?.patterns ?? [])
    .slice(0, 3)
    .map((pattern) => {
      const patternCtx = { ...ctx, patternTechnique: pattern.technique };
      const remaining = players.filter(
        (p) => p.course !== pattern.winnerCourse,
      );
      const scoredForSecond = calculateGroupScores(remaining, patternCtx).sort(
        (a, b) => b.score - a.score,
      );

      const secondCandidates = softmaxProbabilities(
        scoredForSecond,
        softmaxTemp,
      );
      const second = secondCandidates[0] ?? null;

      const remainingPlayersForThird = remaining.filter(
        (p) => p.number !== second?.number,
      );
      const scoredForThird = calculateGroupScores(
        remainingPlayersForThird,
        patternCtx,
      );
      const thirdCandidates = softmaxProbabilities(scoredForThird, softmaxTemp);
      const third = thirdCandidates[0] ?? null;

      const secondProbability = second?.prob ?? 0;
      const thirdProbability = third?.prob ?? 0;
      const combinedProbability =
        (pattern.probability ?? 0) * secondProbability * thirdProbability;

      const secondReasons =
        scoredForSecond.find((s) => s.number === second?.number)?.reasons ?? [];
      const thirdReasons =
        scoredForThird.find((s) => s.number === third?.number)?.reasons ?? [];

      return {
        technique: pattern.technique,
        winnerCourse: pattern.winnerCourse,
        probability: pattern.probability,
        first: pattern.winnerCourse,
        second: second?.number ?? null,
        third: third?.number ?? null,
        secondProbability,
        thirdProbability,
        combinedProbability,
        secondReasons,
        thirdReasons,
        // キャリブレーション検証用: softmax変換前の生スコア（scripts/analysis/calibrate-unified-model.js）
        secondScores: scoredForSecond.map((s) => ({
          number: s.number,
          score: s.score,
        })),
        thirdScores: scoredForThird.map((s) => ({
          number: s.number,
          score: s.score,
        })),
      };
    });

  return { boatScores, patterns: patternResults };
}

// AIスコアのsoftmax温度パラメータ
// v3（Zスコアベース）移行後に scripts/analysis/calibrate-unified-model.js で再グリッドサーチ
// （2026-08-12、1000レース分）。temp=120で2着確率の加重平均乖離3.02pt・3着3.98ptと最小
const SCORE_SOFTMAX_TEMP = 120;

/**
 * 艇群のAIスコアをsoftmax変換して確率化する。
 * @param {Array<{number:number, score:number}>} scored - スコア降順である必要はない
 * @param {number} [temperature] - softmax温度。省略時はSCORE_SOFTMAX_TEMP
 * @returns {Array<{number:number, score:number, prob:number}>} 確率降順でソートして返す
 */
export function softmaxProbabilities(scored, temperature = SCORE_SOFTMAX_TEMP) {
  if (!scored || scored.length === 0) return [];
  const scores = scored.map((s) => s.score);
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return scored
    .map((s, i) => ({
      ...s,
      prob: sum > 0 ? exps[i] / sum : 1 / scored.length,
    }))
    .sort((a, b) => b.prob - a.prob);
}
