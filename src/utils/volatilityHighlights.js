/**
 * ホームの「本日のイン崩れ注意度ハイライト」で、上位（崩れやすい）と下位（本命有利）に出すレースを選ぶ
 * （純関数。verify-frontend-pure-functions で固定）。
 *
 * 締切を過ぎたレースも締切前と同じ見た目で並び、これから見る・買うレースを選ぶ導線にならなかった
 * （BOA-757）。締切前のレースが2本以上あれば、締切前だけから選ぶ。2本未満（夕方以降）は全レースから
 * 選び、締切済みとして出す（allClosed）。締切前が1本だけだと上位・下位に分けられず、一覧ごと
 * 消えてしまうため、締切前0本と同じ扱いにする
 *
 * @param {Array<{percentile: number, closed: boolean}>} races 中止・代わりの値（isFallback）を除いたレース
 * @param {number} maxCount 上位・下位それぞれの最大本数
 * @returns {{high: Array, low: Array, allClosed: boolean}}
 */
export function pickVolatilityHighlights(races, maxCount) {
  const open = races.filter((r) => !r.closed);
  const allClosed = open.length < 2;
  const pool = allClosed ? races : open;
  const n = Math.min(maxCount, Math.floor(pool.length / 2));
  if (n === 0) return { high: [], low: [], allClosed };
  const sorted = [...pool].sort((a, b) => b.percentile - a.percentile);
  return {
    high: sorted.slice(0, n),
    low: sorted.slice(pool.length - n).reverse(),
    allClosed,
  };
}
