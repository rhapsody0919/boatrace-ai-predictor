/**
 * ホームの「本日のイン崩れ注意度ハイライト」で、「イン崩れ注意（高）」と「本命有利」に出すレースを選ぶ
 * （純関数。verify-frontend-pure-functions で固定）。
 *
 * - 締切前のレースが1本でもあれば、締切前だけから選ぶ。締切を過ぎたレースが締切前と同じ見た目で並び、
 *   これから見る・買うレースを選ぶ導線にならなかった（BOA-757）
 * - 締切前が0本（夜）なら全レースから選び、振り返りとして出す（allClosed）
 * - 列に入れるのは、その列の段階（level）のレースだけ。上位・下位の本数で切ると、夕方の残り数本の中では
 *   崩れやすさ28〜33の「標準」のレースが「イン崩れ注意（高）」に入り、「本命有利」より低いこともあった
 *   （PR #1248 ファン評価1周目）。段階はレース詳細と同じ（getVolatilityLevel。高: 70以上、本命有利: 30以下）
 *
 * @param {Array<{percentile: number, level: "high"|"standard"|"low", closed: boolean}>} races
 *   中止・代わりの値（isFallback）を除いたレース
 * @param {number} maxCount 列ごとの最大本数
 * @param {string} [key] 並べる値の名前。旧指数は percentile（0〜1）、BOA-822 のイン崩れ注意度は pct（0〜100）
 * - 選ぶ対象（pool）が1本でもあれば、片方の列が空でも節は出す（呼び出し側が「該当なし」と書く）。
 *   空の列や節ごと消すと、夕方に崩れ注意の列だけ・節ごとが説明なく消えた（PR #1248 ファン評価2周目）
 * - 同じ値のレースは締切の早い順（startTime "HH:MM"、無いものは後ろ）。pct は整数で同値が多く、
 *   入力の順（会場の順）で5本目の境が決まっていた（PR #1602 レビュー）
 * @returns {{high: Array, low: Array, allClosed: boolean, poolSize: number}}
 */
export function pickVolatilityHighlights(races, maxCount, key = "percentile") {
  const open = races.filter((r) => !r.closed);
  const allClosed = open.length === 0;
  const pool = allClosed ? races : open;
  const byStartTime = (a, b) =>
    (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99");
  const high = pool
    .filter((r) => r.level === "high")
    .sort((a, b) => b[key] - a[key] || byStartTime(a, b))
    .slice(0, maxCount);
  const low = pool
    .filter((r) => r.level === "low")
    .sort((a, b) => a[key] - b[key] || byStartTime(a, b))
    .slice(0, maxCount);
  return { high, low, allClosed, poolSize: pool.length };
}
