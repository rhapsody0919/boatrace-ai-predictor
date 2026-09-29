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

/**
 * 機力指数の見せ方（BOA-549、2026-09-29 ファン4人のパネルで決定）。
 * 走数が少ないと、4走でも「選手の実力より低調」と言い切ってしまう（丸亀65号機は
 * 「3着 3着 1着 1着」で -3.1＝低調と出ていた）。n が小さいときは評価の言葉を出さず、
 * 枠番別成績と同じ参考値の色にする。
 * @param {number|null} index 機力指数
 * @param {number|null} n 走数（sample_count）
 * @param {number} threshold これ未満を小標本とみなす
 * @returns {"good"|"bad"|"even"|"small"|null} 値が無ければ null
 */
export function powerIndexTone(index, n, threshold) {
  if (index === null || index === undefined) return null;
  if (n !== null && n !== undefined && n < threshold) return "small";
  // 小数1桁に丸めて 0 になる値は「0.0」と出すので、良い・悪いと言わない
  // （「0.0 — 選手の実力より低調」と赤で出ていた。2026-09-29 ファン評価）
  if (Number(index.toFixed(1)) === 0) return "even";
  if (index > 0) return "good";
  return "bad";
}

/**
 * 機力指数の符号付き表示（小数1桁）。0 に近い負の値を丸めると「-0.0」になるので、
 * 丸めた結果が 0 なら「0.0」と出す（BOA-549）
 * @param {number} index
 * @returns {string} 「+12.1」「-4.1」「0.0」
 */
export function formatPowerIndex(index) {
  const rounded = index.toFixed(1);
  if (Number(rounded) === 0) return "0.0";
  return index > 0 ? `+${rounded}` : rounded;
}
