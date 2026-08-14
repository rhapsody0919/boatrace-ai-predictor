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
  const venueOverride = VENUE_VOLATILITY_WEIGHTS[venueCode] || {};

  const W = {
    winRate: venueOverride.winRate ?? 0.42,
    avgST: venueOverride.avgST ?? 0.38,
    nigeProb: 0.12,
    sigma: venueOverride.sigma ?? 0.05,
    venue: 0.03,
  };

  const factors = []; // { value, weight, reason }

  // A. 1号艇の全国勝率 — 低いほどイン崩れしやすい
  const boat1 = racers.find((r) => r.number === 1);
  const boat1WinRate = boat1 ? parseFloat(boat1.winRate) : null;
  if (boat1WinRate != null) {
    const norm = 1 - Math.min(1, Math.max(0, boat1WinRate / 8.5));
    let reason;
    if (boat1WinRate < 4.0)
      reason = `1号艇の全国勝率が非常に低い（${boat1WinRate.toFixed(2)}）→ イン崩れリスク高`;
    else if (boat1WinRate < 5.5)
      reason = `1号艇の全国勝率がやや低い（${boat1WinRate.toFixed(2)}）→ 崩れやすい`;
    else if (boat1WinRate >= 7.0)
      reason = `1号艇の全国勝率が非常に高い（${boat1WinRate.toFixed(2)}）→ 逃げ鉄板`;
    else if (boat1WinRate >= 6.0)
      reason = `1号艇の全国勝率が高い（${boat1WinRate.toFixed(2)}）→ 逃げ安定`;
    else reason = `1号艇の全国勝率は標準（${boat1WinRate.toFixed(2)}）`;
    factors.push({ value: norm, weight: W.winRate, reason });
  }

  // B. 1号艇の今節avgST — 遅いほどイン崩れしやすい
  const boat1ST =
    racerStatsList?.find((s) => s.boatNumber === 1)?.avgST ?? null;
  if (boat1ST != null) {
    const norm = Math.min(1, Math.max(0, (boat1ST - 0.07) / (0.34 - 0.07)));
    let reason;
    if (boat1ST >= 0.22)
      reason = `1号艇の今節STが非常に遅い（平均${boat1ST.toFixed(3)}秒）→ 出遅れリスク大`;
    else if (boat1ST >= 0.18)
      reason = `1号艇の今節STが遅い（平均${boat1ST.toFixed(3)}秒）→ イン崩れリスク`;
    else if (boat1ST <= 0.1)
      reason = `1号艇の今節STが非常に速い（平均${boat1ST.toFixed(3)}秒）→ 逃げ鉄板`;
    else if (boat1ST <= 0.14)
      reason = `1号艇の今節STが速い（平均${boat1ST.toFixed(3)}秒）→ スタート安定`;
    else reason = `1号艇の今節STは標準（平均${boat1ST.toFixed(3)}秒）`;
    factors.push({ value: norm, weight: W.avgST, reason });
  }

  // C. AI逃げ確率 — 低いほどイン崩れしやすい
  const nigeProb = turnPrediction?.distribution?.nige ?? null;
  if (nigeProb != null) {
    const norm = 1 - Math.min(1, Math.max(0, (nigeProb - 0.2) / (0.99 - 0.2)));
    const nigePct = (nigeProb * 100).toFixed(0);
    let reason;
    if (nigeProb < 0.3)
      reason = `AI逃げ確率が非常に低い（${nigePct}%）→ まくり・差しが有力`;
    else if (nigeProb < 0.43)
      reason = `AI逃げ確率が低い（${nigePct}%）→ まくり・差し有力`;
    else if (nigeProb >= 0.75)
      reason = `AI逃げ確率が非常に高い（${nigePct}%）→ 逃げ鉄板`;
    else if (nigeProb >= 0.6)
      reason = `AI逃げ確率が高い（${nigePct}%）→ 逃げ安定`;
    else reason = `AI逃げ確率は標準（${nigePct}%）`;
    factors.push({ value: norm, weight: W.nigeProb, reason });
  }

  // D. 選手間の勝率σ — 高いほどイン崩れしやすい
  const winRates = racers
    .map((r) => parseFloat(r.winRate))
    .filter((v) => !isNaN(v));
  if (winRates.length >= 4) {
    const stddev = calculateStdDev(winRates);
    const norm = Math.min(1, Math.max(0, (stddev - 0.06) / (2.75 - 0.06)));
    let reason;
    if (stddev >= 1.5)
      reason = `選手間の実力差が大きい（σ=${stddev.toFixed(2)}）→ 外枠に実力者の可能性`;
    else if (stddev >= 1.0)
      reason = `選手間の実力差がやや大きい（σ=${stddev.toFixed(2)}）→ 波乱の要因`;
    else if (stddev < 0.5)
      reason = `選手間の実力が拮抗（σ=${stddev.toFixed(2)}）→ 接戦になりやすい`;
    else reason = `選手間の実力差は標準（σ=${stddev.toFixed(2)}）`;
    factors.push({ value: norm, weight: W.sigma, reason });
  }

  // E. 会場の1コース勝率 — 低いほどイン崩れしやすい
  // 動的実績値（直近90日、venueWinRateCache）を優先し、未取得時は静的定数にフォールバック
  const dynamicVenueRate = venueWinRateCache[parseInt(venueCode, 10)] ?? null;
  const venueWinRate =
    dynamicVenueRate ?? VENUE_1COURSE_WIN_RATE[venueCode] ?? VENUE_1COURSE_AVG;
  {
    const norm =
      1 - Math.min(1, Math.max(0, (venueWinRate - 0.43) / (0.62 - 0.43)));
    factors.push({ value: norm, weight: W.venue });
  }

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

  const reasons = [...factors]
    .filter((f) => f.reason)
    .sort(
      (a, b) =>
        Math.abs(b.value - 0.5) * b.weight - Math.abs(a.value - 0.5) * a.weight,
    )
    .slice(0, 3)
    .map((f) => f.reason);

  return { composite, reasons, boat1AvgST: boat1ST };
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
