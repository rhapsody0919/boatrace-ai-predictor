/**
 * getVolatilityLevel - イン崩れ指数（percentile）からレベルを判定する共通ヘルパー
 * VolatilityDisplay.jsx・RaceMoodEffect.jsxで同じ基準を共有する
 */
export function getVolatilityLevel(percentile) {
  if (percentile === null || percentile === undefined) return null;
  if (percentile >= 0.7) return "high";
  if (percentile <= 0.3) return "low";
  return "standard";
}

/**
 * イン崩れ指数を画面に出す 0〜100 の数値。ラベル（getVolatilityLevel）の境目をまたがないようにする。
 *
 * 四捨五入だけだと、0.6975 は「70・標準」、0.7037 は「70・イン崩れ確率高」になり、同じ70なのに
 * ラベルと色が違った（下側も 0.300 は「30・本命有利」、0.304 は「30・標準」）（PR #1186 ファン評価
 * 1・2周目）。判定は丸める前の値で行うので、表示の数値をラベルの範囲に収める
 * （高: 70以上、本命有利: 30以下、標準: 31〜69）
 *
 * @param {number} percentile 0〜1
 * @returns {number}
 */
export function volatilityDisplayValue(percentile) {
  const value = Math.round(percentile * 100);
  const level = getVolatilityLevel(percentile);
  if (level === "high") return Math.max(value, 70);
  if (level === "low") return Math.min(value, 30);
  return Math.min(Math.max(value, 31), 69);
}
