/**
 * 同じ値は同じ順位にする順位（競技順位方式: 1, 2, 2, 4 …）（純関数、BOA-529）。
 *
 * 並べ替えた配列の位置をそのまま順位にすると、同じ値の中での順位が DB の行順で
 * 決まる（丸亀11号機の2連率44.4は5基が同値なのに「13位」と出ていた）。
 * 今節タブの得点率順位（「2位タイ」）と同じ付け方。
 *
 * @param {Array<number>} values 比べる値（null・undefined は呼び出し側で除く）
 * @param {number} target 順位を知りたい値
 * @param {{ascending?: boolean}} [options] 小さいほど良い指標なら true
 * @returns {{rank: number, tied: number}} 順位と、同じ値の件数（自分を含む）
 */
export function competitionRank(values, target, { ascending = false } = {}) {
  const better = values.filter((v) => (ascending ? v < target : v > target));
  const tied = values.filter((v) => v === target).length;
  return { rank: better.length + 1, tied };
}
