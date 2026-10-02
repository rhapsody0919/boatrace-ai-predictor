/**
 * 6艇を並べた値の中で、レース内の最良の艇番を返す（docs/design/race-detail-ui-unify spec R1）。
 *
 * - 同じ値で並んだ最良は全部返す（2026-10-02 ユーザー承認。1艇だけ光らせると、
 *   並んだ艇が劣って見える）
 * - 値のある艇が無い、または全艇が同じ値なら空集合（差が無いものは強調しない）
 * - null / undefined / NaN は候補から外す
 *
 * `digits` を渡すと、画面に出す桁に丸めてから比べる。生の値で比べると、
 * 表示が同じ「54.8」（54.84 と 54.80）の片方だけが光ったり、JS で平均した
 * 6.710000000000001 と 6.71 が別の値になったりする。呼び出し側は表示と同じ桁を渡す
 *
 * @param {{boat: number, value: number|null|undefined}[]} candidates
 * @param {"max"|"min"} [dir] 高いほど良いなら "max"、低いほど良いなら "min"
 * @param {{digits?: number}} [options]
 * @returns {Set<number>}
 */
export function bestOf(candidates, dir = "max", { digits } = {}) {
  const round = (v) => (digits === undefined ? v : Number(v.toFixed(digits)));
  const values = (candidates ?? [])
    .filter((c) => typeof c.value === "number" && !Number.isNaN(c.value))
    .map((c) => ({ boat: c.boat, value: round(c.value) }));
  if (values.length === 0) return new Set();
  const vs = values.map((c) => c.value);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  if (min === max) return new Set();
  const target = dir === "min" ? min : max;
  return new Set(values.filter((c) => c.value === target).map((c) => c.boat));
}
