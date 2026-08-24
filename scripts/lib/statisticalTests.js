/**
 * 統計検証ユーティリティ（正規近似ベース、外部ライブラリ非依存）
 * docs/adr/0020-fortune-correlation-statistical-method.md 準拠
 */

/**
 * 標準正規分布の累積分布関数（Abramowitz-Stegun近似）
 * @param {number} z
 * @returns {number} P(Z <= z)
 */
export function normalCDF(z) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * absZ);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);
  return 0.5 * (1 + sign * y);
}

/**
 * Pearson相関係数
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number}
 */
export function pearsonCorrelation(x, y) {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  const numerator = x.reduce(
    (sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY),
    0,
  );
  const denomX = Math.sqrt(x.reduce((sum, xi) => sum + (xi - meanX) ** 2, 0));
  const denomY = Math.sqrt(y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0));

  return numerator / (denomX * denomY);
}

/**
 * 相関係数の両側p値（t統計量を正規近似。サンプル数が数万規模のため妥当）
 * @param {number} r 相関係数
 * @param {number} n サンプル数
 * @returns {number}
 */
export function pearsonPValue(r, n) {
  if (n <= 2) return 1;
  if (Math.abs(r) >= 1) return 0;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - normalCDF(Math.abs(t)));
}

/**
 * 二項比率の正規近似z検定（観測比率がベースライン比率と有意に異なるか、両側検定）
 * @param {number} successCount 観測された成功数
 * @param {number} trials 試行数
 * @param {number} baselineP ベースラインの比率（0-1）
 * @returns {number} p値
 */
export function proportionZTest(successCount, trials, baselineP) {
  if (trials === 0) return 1;
  const observedP = successCount / trials;
  const se = Math.sqrt((baselineP * (1 - baselineP)) / trials);
  if (se === 0) return 1;
  const z = Math.abs(observedP - baselineP) / se;
  return 2 * (1 - normalCDF(z));
}
