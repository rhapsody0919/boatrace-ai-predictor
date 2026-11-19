/**
 * イン崩れ因子（複合スコア・会場内パーセンタイル変換）
 * AI予想モデル大規模改修 Task5, ADR0012
 *
 * 既存 scripts/daily/generate-predictions.js の calculateVolatilityScore（6因子の重み付き複合スコア、
 * 過去90日13,094件の実データで検証済み）のロジックを移植する。ただし、BOA-156（high/medium/lowラベルの
 * 会場別閾値がスコアの実効レンジ30-70と噛み合わずhigh判定がほぼ発動しない）を踏襲しないため、
 * 「30 + composite * 40」の固定レンジキャリブレーションは行わず、0-1の複合値（composite）をそのまま返す。
 * 新モデルの特徴量としては、この composite を会場内パーセンタイルに変換した値を使う（ADR0012）。
 */

import {
  VENUE_1COURSE_WIN_RATE,
  VENUE_1COURSE_AVG,
} from "./venueParameters.js";

// 会場別イン崩れ指数 重みオーバーライド
// 根拠: redesign-volatility-by-venue.js による180日・会場別スピアマン相関分析（2026-04-30）
// デフォルト重み: 全国勝率42% / avgST38% / AI逃げ12% / σ5% / 会場3%（モーター除外）
// 基準: avgST の ρ が全国勝率の ρ を上回る会場 → avgST 増・winRate 微減
// scripts/daily/generate-predictions.js の VENUE_VOLATILITY_WEIGHTS と同一（移植元）
const VENUE_VOLATILITY_WEIGHTS = {
  14: { avgST: 0.52, winRate: 0.3 }, // 鳴門
  24: { avgST: 0.5, winRate: 0.32 }, // 大村
  20: { avgST: 0.48, winRate: 0.32 }, // 若松
  15: { avgST: 0.46, winRate: 0.34 }, // 丸亀
  "03": { avgST: 0.46, winRate: 0.34 }, // 江戸川
  17: { avgST: 0.44, winRate: 0.36 }, // 宮島
  16: { avgST: 0.44, winRate: 0.36 }, // 児島
  "09": { avgST: 0.44, winRate: 0.36 }, // 津
};

function calculateStdDev(values) {
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squareDiffs = values.map((val) => Math.pow(val - avg, 2));
  const avgSquareDiff =
    squareDiffs.reduce((sum, val) => sum + val, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * イン崩れ複合スコア（0-1、キャリブレーションなし）を算出する。
 * @param {Array} racers - 6艇の選手データ（{ number, winRate, ... }）
 * @param {number|string} placeCd - 会場コード
 * @param {Object} turnPrediction - predictFirstMark の出力（distribution.nige を使用）
 * @param {Array} racerStatsList - [{ boatNumber, avgST }]
 * @param {Object} [venueWinRateCache] - 会場別1コース勝率の動的キャッシュ（venueCode(number) -> rate）。
 *   省略時は VENUE_1COURSE_WIN_RATE（静的定数）にフォールバックする
 * @returns {{ composite: number, reasons: string[], boat1AvgST: number|null }}
 */
/**
 * イン崩れ指数の理由文のうち、1号艇の平均STの1行（BOA-818）。
 * 値は racer_aggregated_stats.avg_st（当サイトに蓄積した全期間、F 除外）なので、その期間どおりに書く。
 * 以前は「今節ST」と書いていたが、今節の走ではなかった。値の期間を直近30走に替えるのは
 * イン崩れ指数の作り直しでまとめて行う（2026-10-10 オーケストレーター判断）
 * @param {number} boat1ST
 * @returns {string}
 */
export function boat1StReason(boat1ST) {
  const v = `${boat1ST.toFixed(3)}秒`;
  const label = "1号艇の平均ST（当サイトに蓄積した全期間）";
  if (boat1ST >= 0.22) return `${label}が非常に遅い（${v}）→ 出遅れリスク大`;
  if (boat1ST >= 0.18) return `${label}が遅い（${v}）→ イン崩れリスク`;
  if (boat1ST <= 0.1) return `${label}が非常に速い（${v}）→ 逃げ鉄板`;
  if (boat1ST <= 0.14) return `${label}が速い（${v}）→ スタート安定`;
  return `${label}は標準（${v}）`;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** 会場の重み（会場別の上書きを既定に重ねる） */
function volatilityWeights(venueCode) {
  const venueOverride = VENUE_VOLATILITY_WEIGHTS[venueCode] || {};
  return {
    winRate: venueOverride.winRate ?? 0.42,
    avgST: venueOverride.avgST ?? 0.38,
    nigeProb: 0.12,
    sigma: venueOverride.sigma ?? 0.05,
    venue: 0.03,
  };
}

function boat1WinRateReason(boat1WinRate) {
  const v = boat1WinRate.toFixed(2);
  if (boat1WinRate < 4.0)
    return `1号艇の全国勝率が非常に低い（${v}）→ イン崩れリスク高`;
  if (boat1WinRate < 5.5)
    return `1号艇の全国勝率がやや低い（${v}）→ 崩れやすい`;
  if (boat1WinRate >= 7.0)
    return `1号艇の全国勝率が非常に高い（${v}）→ 逃げ鉄板`;
  if (boat1WinRate >= 6.0) return `1号艇の全国勝率が高い（${v}）→ 逃げ安定`;
  return `1号艇の全国勝率は標準（${v}）`;
}

function nigeReason(nigeProb) {
  const nigePct = (nigeProb * 100).toFixed(0);
  if (nigeProb < 0.3)
    return `AI逃げ確率が非常に低い（${nigePct}%）→ まくり・差しが有力`;
  if (nigeProb < 0.43)
    return `AI逃げ確率が低い（${nigePct}%）→ まくり・差し有力`;
  if (nigeProb >= 0.75)
    return `AI逃げ確率が非常に高い（${nigePct}%）→ 逃げ鉄板`;
  if (nigeProb >= 0.6) return `AI逃げ確率が高い（${nigePct}%）→ 逃げ安定`;
  return `AI逃げ確率は標準（${nigePct}%）`;
}

function sigmaReason(stddev) {
  const v = stddev.toFixed(2);
  if (stddev >= 1.5)
    return `選手間の実力差が大きい（σ=${v}）→ 外枠に実力者の可能性`;
  if (stddev >= 1.0) return `選手間の実力差がやや大きい（σ=${v}）→ 波乱の要因`;
  if (stddev < 0.5) return `選手間の実力が拮抗（σ=${v}）→ 接戦になりやすい`;
  return `選手間の実力差は標準（σ=${v}）`;
}

/** A. 1号艇の全国勝率 — 低いほどイン崩れしやすい */
function winRateFactor(racers, weight) {
  const boat1 = racers.find((r) => r.number === 1);
  const boat1WinRate = boat1 ? parseFloat(boat1.winRate) : null;
  if (boat1WinRate == null) return null;
  const value = 1 - clamp01(boat1WinRate / 8.5);
  return { value, weight, reason: boat1WinRateReason(boat1WinRate) };
}

/** B. 1号艇の平均ST（当サイトに蓄積した全期間）— 遅いほどイン崩れしやすい */
function avgStFactor(boat1ST, weight) {
  if (boat1ST == null) return null;
  const value = clamp01((boat1ST - 0.07) / (0.34 - 0.07));
  return { value, weight, reason: boat1StReason(boat1ST) };
}

/** C. AI逃げ確率 — 低いほどイン崩れしやすい */
function nigeFactor(turnPrediction, weight) {
  const nigeProb = turnPrediction?.distribution?.nige ?? null;
  if (nigeProb == null) return null;
  const value = 1 - clamp01((nigeProb - 0.2) / (0.99 - 0.2));
  return { value, weight, reason: nigeReason(nigeProb) };
}

/** D. 選手間の勝率σ — 高いほどイン崩れしやすい */
function sigmaFactor(racers, weight) {
  const winRates = racers
    .map((r) => parseFloat(r.winRate))
    .filter((v) => !isNaN(v));
  if (winRates.length < 4) return null;
  const stddev = calculateStdDev(winRates);
  const value = clamp01((stddev - 0.06) / (2.75 - 0.06));
  return { value, weight, reason: sigmaReason(stddev) };
}

/** E. 会場の1コース勝率 — 低いほどイン崩れしやすい。
 * 動的実績値（直近90日、venueWinRateCache）を優先し、未取得時は静的定数にフォールバック */
function venueFactor(venueCode, venueWinRateCache, weight) {
  const dynamicVenueRate = venueWinRateCache[parseInt(venueCode, 10)] ?? null;
  const venueWinRate =
    dynamicVenueRate ?? VENUE_1COURSE_WIN_RATE[venueCode] ?? VENUE_1COURSE_AVG;
  return { value: 1 - clamp01((venueWinRate - 0.43) / (0.62 - 0.43)), weight };
}

/** 理由の上位3つ（0.5 からの離れ×重みの大きい順） */
function topReasons(factors) {
  return [...factors]
    .filter((f) => f.reason)
    .sort(
      (a, b) =>
        Math.abs(b.value - 0.5) * b.weight - Math.abs(a.value - 0.5) * a.weight,
    )
    .slice(0, 3)
    .map((f) => f.reason);
}

export function calculateVolatilityComposite(
  racers,
  placeCd,
  turnPrediction,
  racerStatsList,
  venueWinRateCache = {},
) {
  if (!racers || racers.length < 6) {
    return {
      composite: 0.5,
      reasons: ["選手データが不足しています"],
      boat1AvgST: null,
    };
  }

  const venueCode = String(placeCd).padStart(2, "0");
  const W = volatilityWeights(venueCode);
  const boat1ST =
    racerStatsList?.find((s) => s.boatNumber === 1)?.avgST ?? null;
  const factors = [
    winRateFactor(racers, W.winRate),
    avgStFactor(boat1ST, W.avgST),
    nigeFactor(turnPrediction, W.nigeProb),
    sigmaFactor(racers, W.sigma),
    venueFactor(venueCode, venueWinRateCache, W.venue),
  ].filter(Boolean);

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) {
    return {
      composite: 0.5,
      reasons: ["データ不足"],
      boat1AvgST: boat1ST ?? null,
    };
  }

  // v6: キャリブレーションなし（ADR0012）。0-1の複合値をそのまま返す
  // 旧ロジックの「30 + composite * 40」固定レンジ変換（BOA-156の原因）は行わない
  const composite = factors.reduce(
    (s, f) => s + f.value * (f.weight / totalWeight),
    0,
  );

  return { composite, reasons: topReasons(factors), boat1AvgST: boat1ST };
}

/**
 * 複合スコアを会場内パーセンタイルに変換する（ADR0012、会場内相対順位）。
 * @param {number} compositeValue - 対象レースの複合スコア（0-1）
 * @param {number[]} distribution - 比較対象となる同会場レース群の複合スコア配列（直近N日等）
 * @returns {number} 0-1のパーセンタイル（distribution中でcompositeValue以下の割合）
 */
export function toVolatilityPercentile(compositeValue, distribution) {
  if (!distribution || distribution.length === 0) return 0.5;
  const countBelowOrEqual = distribution.filter(
    (v) => v <= compositeValue,
  ).length;
  return countBelowOrEqual / distribution.length;
}
