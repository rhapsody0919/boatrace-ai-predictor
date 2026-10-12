/** sns-pdca-baseline の共通の集計と、必要件数（検出力0.8・両側α=0.05）の式。 */
const Z = 1.959964 + 0.841621; // z(α/2=0.025) + z(β=0.2)

export function summarize(values) {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const sd =
    n > 1
      ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
      : 0;
  return {
    n,
    sum,
    mean: round(mean),
    sd: round(sd),
    zeroDays: values.filter((v) => v === 0).length,
  };
}

export function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

/** 平均の差（正規近似）。sd は1件ごとの SD、delta は検出したい差。版ごとの件数を返す */
export const nForMeanDiff = (sd, delta) =>
  Math.ceil((2 * Z ** 2 * sd ** 2) / delta ** 2);

/** 計数（ポアソン、過分散 phi）。lambda は1単位あたりの平均、lift は比（1.2 等）。版ごとの単位数 */
export const nForRate = (lambda, lift, phi = 1) =>
  Math.ceil(
    (phi * Z ** 2 * (lambda + lambda * lift)) / (lambda * lift - lambda) ** 2,
  );

/** 割合の差。p0 から p1 を見分けるのに版ごとに要る件数 */
export const nForProportion = (p0, p1) =>
  Math.ceil((Z ** 2 * (p0 * (1 - p0) + p1 * (1 - p1))) / (p1 - p0) ** 2);

/** 対数にした値で、比 lift を見分ける件数（再生回数のように裾が長いもの） */
export const nForLogLift = (logSd, lift) => nForMeanDiff(logSd, Math.log(lift));

export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
