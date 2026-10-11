/**
 * 龍神ソナーの図の輪（承認モック sonar-tab v3）。外周＝今の件数で、内側の輪は決まった番目（5・10・25・50・100・200・400 のうち間が空くもの）
 * に引く。件数を減らすと図が拡大して輪が外へ広がる。ラベルが重ならないよう、隣の輪・外周と MIN_GAP 未満に
 * 詰まる輪は省く（最大3本）
 */
const RING_STEPS = [5, 10, 25, 50, 100, 200, 400];
const MIN_GAP = 24;
const MAX_RINGS = 3;

/**
 * @param {number} n 今の件数（外周）
 * @param {(rank: number) => number} rOf 番目 → 中心からの距離（SVG の単位）
 * @returns {number[]} 内側の輪の番目（小さい順）
 */
export function sonarRings(n, rOf) {
  if (!Number.isFinite(n) || n < 2) return [];
  const outer = rOf(n);
  const out = [];
  let last = -Infinity;
  for (const k of RING_STEPS) {
    if (k >= n) break;
    const r = rOf(k);
    if (r - last >= MIN_GAP && outer - r >= MIN_GAP) {
      out.push(k);
      last = r;
    }
  }
  return out.slice(-MAX_RINGS);
}
