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
