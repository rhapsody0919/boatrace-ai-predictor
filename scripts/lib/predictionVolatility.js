// 予想の荒れ度（イン崩れ指数）の計算。scripts/daily/generate-predictions.js の calculateVolatilityScore と、その因子・重み・レベル判定を
// 元から移した（会場別の1コース勝率の実績値 venueWinRateCache は呼び元が持ち、引数で渡す）。
import { boat1StReason } from "./volatilityFactors.js";
import {
  VENUE_1COURSE_WIN_RATE,
  VENUE_1COURSE_AVG,
  getVolatilityThreshold,
} from "./venueParameters.js";

// 標準偏差を計算
export function calculateStdDev(values) {
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squareDiffs = values.map((val) => Math.pow(val - avg, 2));
  const avgSquareDiff =
    squareDiffs.reduce((sum, val) => sum + val, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

// 会場別イン崩れ指数 重みオーバーライド
// 根拠: redesign-volatility-by-venue.js による180日・会場別スピアマン相関分析（2026-04-30）
// デフォルト重み: 全国勝率42% / avgST38% / AI逃げ12% / σ5% / 会場3%（モーター除外）
// 基準: avgST の ρ が全国勝率の ρ を上回る会場 → avgST 増・winRate 微減
const VENUE_VOLATILITY_WEIGHTS = {
  // ── avgSTが全国勝率より強い会場 ──
  14: { avgST: 0.52, winRate: 0.3 }, // 鳴門:  avgST ρ=0.615（全会場最強）
  24: { avgST: 0.5, winRate: 0.32 }, // 大村:  avgST ρ=0.444
  20: { avgST: 0.48, winRate: 0.32 }, // 若松:  avgST ρ=0.366
  15: { avgST: 0.46, winRate: 0.34 }, // 丸亀:  avgST ρ=0.294
  "03": { avgST: 0.46, winRate: 0.34 }, // 江戸川: avgST ρ=0.288
  17: { avgST: 0.44, winRate: 0.36 }, // 宮島:  avgST ρ=0.250
  16: { avgST: 0.44, winRate: 0.36 }, // 児島:  avgST ρ=0.261
  "09": { avgST: 0.44, winRate: 0.36 }, // 津:    avgST ρ=0.279
};

// 会場別重みを適用（オーバーライドがなければデフォルト値）
// デフォルト: 全国勝率42% / avgST38% / AI逃げ12% / σ5% / 会場3%
// モーター2連率は全会場でρ<0.10のため除外（2026-04-30分析）
export function volatilityWeights(venueCode) {
  const venueOverride = VENUE_VOLATILITY_WEIGHTS[venueCode] || {};
  return {
    winRate: venueOverride.winRate ?? 0.42,
    avgST: venueOverride.avgST ?? 0.38,
    nigeProb: 0.12,
    sigma: venueOverride.sigma ?? 0.05,
    venue: 0.03,
  };
}

// A. 1号艇の全国勝率 — 低いほどイン崩れしやすい
// 観測レンジ: 0〜8.49。予測力 35.2pt差（最強因子）
export function volatilityFactorWinRate(racers, weight) {
  const boat1 = racers.find((r) => r.number === 1);
  const boat1WinRate = boat1 ? parseFloat(boat1.winRate) : null;
  if (boat1WinRate == null) return null;
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
  return { value: norm, weight, reason };
}

// B. 1号艇の平均ST（当サイトに蓄積した全期間） — 遅いほどイン崩れしやすい
// 観測レンジ: 0.07〜0.34。予測力 26.7pt差
export function volatilityFactorAvgST(boat1ST, weight) {
  if (boat1ST == null) return null;
  const norm = Math.min(1, Math.max(0, (boat1ST - 0.07) / (0.34 - 0.07)));
  const reason = boat1StReason(boat1ST);
  return { value: norm, weight, reason };
}

// C. AI逃げ確率 — 低いほどイン崩れしやすい
// 観測レンジ: 0.20〜0.99。予測力 10.8pt差
export function volatilityFactorNige(turnPrediction, weight) {
  const nigeProb = turnPrediction?.distribution?.nige ?? null;
  if (nigeProb == null) return null;
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
  return { value: norm, weight, reason };
}

// D. 選手間の勝率σ — 高いほどイン崩れしやすい（外枠に実力者の可能性）
// 観測レンジ: 0.06〜2.75。予測力 10.4pt差
export function volatilityFactorSigma(racers, weight) {
  const winRates = racers
    .map((r) => parseFloat(r.winRate))
    .filter((v) => !isNaN(v));
  if (winRates.length < 4) return null;
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
  return { value: norm, weight, reason };
}

// E. 会場の1コース勝率 — 低いほどイン崩れしやすい
// 観測レンジ: 0.43〜0.62。予測力 8.1pt差
// 動的実績値（直近90日）を優先し、未取得時は静的定数にフォールバック
// reason は持たない — UIの固定表示（venueWinRate）が担当するため重複を防ぐ
export function volatilityFactorVenue(venueCode, weight, venueWinRateCache) {
  const dynamicVenueRate = venueWinRateCache[parseInt(venueCode, 10)] ?? null;
  const venueWinRate =
    dynamicVenueRate ?? VENUE_1COURSE_WIN_RATE[venueCode] ?? VENUE_1COURSE_AVG;
  const norm =
    1 - Math.min(1, Math.max(0, (venueWinRate - 0.43) / (0.62 - 0.43)));
  return { value: norm, weight };
}

// イン崩れ指数（6因子の重み付き複合スコア）
// 分析根拠: 過去90日13,094件の実データで各因子の予測力を検証（analyze-upset-factors.js）
// 複合スコアで現行スコアの約2倍（36.6pt差）の予測力を確認済み
export function calculateVolatilityScore(
  racers,
  placeCd,
  turnPrediction,
  racerStatsList,
  venueWinRateCache,
) {
  if (!racers || racers.length < 6) {
    return {
      score: 50,
      reasons: ["選手データが不足しています"],
      boat1AvgST: null,
    };
  }

  const venueCode = String(placeCd).padStart(2, "0");
  const W = volatilityWeights(venueCode);

  // 1号艇の平均ST（B因子の入力。返り値の boat1AvgST にも使う）。因子は A→B→C→D→E の順に並べる
  const factorA = volatilityFactorWinRate(racers, W.winRate);
  const boat1ST =
    racerStatsList?.find((s) => s.boatNumber === 1)?.avgST ?? null;
  const factors = [
    factorA,
    volatilityFactorAvgST(boat1ST, W.avgST),
    volatilityFactorNige(turnPrediction, W.nigeProb),
    volatilityFactorSigma(racers, W.sigma),
    volatilityFactorVenue(venueCode, W.venue, venueWinRateCache),
  ].filter((f) => f !== null);

  // 利用可能な因子の重み合計で正規化（avgSTがない場合も対応）
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0)
    return { score: 50, reasons: ["データ不足"], boat1AvgST: boat1ST ?? null };

  const composite = factors.reduce(
    (s, f) => s + f.value * (f.weight / totalWeight),
    0,
  );

  // キャリブレーション: 分析で観測した30〜70%レンジに線形変換
  const finalScore = Math.min(
    100,
    Math.max(0, Math.round(30 + composite * 40)),
  );

  // スコアへの寄与度（中立値0.5からの乖離 × 重み）上位3因子のreasonを採用
  // reason を持つ因子のみ対象（会場勝率はUIの固定表示が担当）
  const reasons = [...factors]
    .filter((f) => f.reason)
    .sort(
      (a, b) =>
        Math.abs(b.value - 0.5) * b.weight - Math.abs(a.value - 0.5) * a.weight,
    )
    .slice(0, 3)
    .map((f) => f.reason);

  return { score: finalScore, reasons, boat1AvgST: boat1ST };
}

// イン崩れ指数のレベルを会場別閾値で判定
// 根拠: 1コース勝率ベースの動的計算（2026-05-09分析）
export function getVolatilityLevel(score, venueCode) {
  const highThr = getVolatilityThreshold(venueCode);
  const lowThr = Math.max(30, highThr - 15); // high閾値から15pt下がlow上限
  if (score < lowThr) return "low"; // 堅い
  if (score < highThr) return "medium"; // 標準
  return "high"; // 崩れやすい
}

// 推奨モデルを volatility level から判定
export function getRecommendedModel(level) {
  if (level === "low") return "safe-bet"; // 本命狙い
  if (level === "high") return "upset-focus"; // 穴狙い
  return "standard"; // スタンダード
}
