/** `MeetSparkline` の viewBox の幅と左右の余白。日付の見出しを点と同じ横位置に置くため共有する */
export const SPARK_VIEW_W = 340;
export const SPARK_PAD_X = 5;

/**
 * 日付の目盛りの文字（純関数）。最初の日と月が変わった日だけ「9/21」、それ以外は
 * 日だけ「23」にする。375pxで7日並ぶと「9/21 9/23 …」が隣と重なった
 * （津 2026-09-28、BOA-538）
 *
 * @param {Array<string>} days YYYY-MM-DD の昇順
 * @returns {Array<string>}
 */
export function dayTickLabels(days) {
  return days.map((d, i) => {
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    const monthChanged = i === 0 || days[i - 1].slice(5, 7) !== d.slice(5, 7);
    return monthChanged ? `${m}/${day}` : `${day}`;
  });
}

/** 0〜1 の横位置を、スパークラインの箱に対する割合（%）にする */
export function sparkLeftPercent(frac) {
  return (
    ((SPARK_PAD_X + frac * (SPARK_VIEW_W - SPARK_PAD_X * 2)) / SPARK_VIEW_W) *
    100
  );
}

/**
 * 6艇の今節の推移を「日付の横軸」で描くための配置（純関数、BOA-538）。
 *
 * 以前は各行が自分の走数で左右いっぱいに伸びていた（x は走った順）。走数が違うと
 * 同じ横位置が別の日になり、行をまたいで「同じ日」と比べられなかった。
 * 節の日（6艇のうち誰かが走った日）を等間隔に並べ、各走をその日の位置に置く。
 *
 * - 1日に2走した日は、その日の位置から左右にずらす（重ねない）
 * - その選手が走らなかった日をまたぐときは線を切る（breakBefore）。つなぐと
 *   走っていない日にも値があるように見える
 * - 縦のガイド線は引かない（2026-09-29 ユーザー判断）
 *
 * @param {Array<{date: string}>} runs その選手の走（古い順）
 * @param {Array<string>} days 節の日（YYYY-MM-DD、昇順、重複なし）
 * @returns {{xs: Array<number>, centers: Array<number>, breakBefore: Array<boolean>}}
 *   xs は各走の横位置、centers はその走の日の位置（どちらも 0〜1 の割合）
 */
/**
 * 節の i 日目（0始まり、全 n 日）の横位置（0〜1）。両端には同じ日の2走を
 * 左右にずらす分の余白を取る（端の日の2走が重ならないように）。日付の目盛りも
 * この位置に置く。
 */
export function dayCenter(i, n) {
  if (n <= 1) return 0.5;
  const step = 1 / (n - 0.5);
  return step / 4 + i * step;
}

export function layoutTrendByDate(runs, days) {
  const n = days.length;
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const center = (i) => dayCenter(i, n);
  // 同じ日の2走の間は日の間隔の0.4倍。半分（0.5）だと、2走が続く行で日をまたぐ間隔と
  // 同じになり、点が等間隔に並んで「どの2点が同じ日か」が見えなかった（BOA-538
  // ファン評価）。節が1日だけなら、全幅に対して0.2（左右に離れすぎない）
  const spread = n <= 1 ? 0.2 : (1 / (n - 0.5)) * 0.4;
  const perDay = new Map();
  runs.forEach((r) => perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1));
  const seen = new Map();
  // その走の日の位置（centers）も返す。描く側が画面の幅に合わせて、日の位置から
  // のずれに上限（px）をかけられるように（広い画面で2走が離れすぎないため）
  const centers = runs.map((r) => center(dayIndex.get(r.date) ?? 0));
  const xs = runs.map((r, j) => {
    const m = perDay.get(r.date) ?? 1;
    const k = seen.get(r.date) ?? 0;
    seen.set(r.date, k + 1);
    const offset = m > 1 ? (k / (m - 1) - 0.5) * spread : 0;
    return Math.min(1, Math.max(0, centers[j] + offset));
  });
  const breakBefore = runs.map((r, j) => {
    if (j === 0) return false;
    const prev = dayIndex.get(runs[j - 1].date) ?? 0;
    const cur = dayIndex.get(r.date) ?? 0;
    return cur - prev > 1;
  });
  return { xs, centers, breakBefore };
}
