/**
 * 出走数が少ないときの率の出し方（BOA-513、2026-09-29 ファン4人のパネルで決定）。
 *
 * 3走で「100.0%」と出すと、母数を見ずに率だけが読まれる。n が小さい（SMALL_SAMPLE_THRESHOLD
 * 未満）ときは、率ではなく「該当数/出走数」（例: 2/3）で出す。n が十分なら今までどおり %。
 *
 * @param {number|null} rate 0〜100 の率（出走が無ければ null）
 * @param {number} n 出走数
 * @param {number} threshold これ未満を小標本とみなす
 * @returns {string} 「2/3」「66.7%」、出走が無ければ「-」
 */
export function formatRateOrCount(rate, n, threshold) {
  if (rate === null || rate === undefined || !n) return "-";
  if (n < threshold) return `${Math.round((rate * n) / 100)}/${n}`;
  return `${rate.toFixed(1)}%`;
}
