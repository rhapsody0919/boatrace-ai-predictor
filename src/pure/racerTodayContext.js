/**
 * 選手ページの「今日の出走」の直下の1段（#3258 の #3）: 今日の枠のコース成績（公式3期）・その場の当地成績・今節の着順。
 * 30走未満は率を出さず「N走中1着M回」（docs/knowledge/number-wording.md、number-scope.md の3）。
 * コースは枠番どおりに入る前提の目安（枠どおりでないレースは場で1.6〜26.8%、docs/reference/venue-course-win-rate.md）
 */

export const SMALL_RUNS = 30;

// 公式と同じく小数1桁の切り捨て（進入コース別の表と同じ向き）。浮動小数の誤差で1つ下がらないよう整数で割る
const pct1 = (count, n) => (Math.floor((count * 1000) / n) / 10).toFixed(1);

/** 1段の元にする走: まだ着の無い最初の走。全部終わっていれば最後の走 */
export function pickContextRun(runs) {
  if (!runs?.length) return null;
  return runs.find((r) => !r.finish) ?? runs[runs.length - 1];
}

/**
 * @param {{course:number, entries:number, wins:number, reliability:string, winRate:number|null, top2Rate:number|null}|undefined} row
 *   buildCourseRows(...).courses の1行（率は % の値）
 */
export function courseCell(row, periods = 3) {
  if (!row || row.reliability === "none" || !(row.entries > 0)) return null;
  // 枠番どおりに入る前提の目安。期の数は合算に使った期から（3期に満たない選手もいる）
  const title = `${row.course}コース（公式${periods}期）`;
  if (row.entries < SMALL_RUNS) {
    return { title, main: `${row.entries}走中1着${row.wins}回`, sub: null };
  }
  const top2 = Math.round((row.top2Rate * row.entries) / 100);
  return { title, main: `1着 ${pct1(row.wins, row.entries)}%`, sub: `2連対率 ${pct1(top2, row.entries)}%・${row.entries}走` };
}

/** @param {{n:number, win:number, top2:number}|null} stats その場に絞った当サイト集計の走 */
export function venueCell(stats, venueName) {
  if (!stats) return null;
  // 会場別成績の節と同じ当サイト集計（直近2年）
  const title = `${venueName}の当地（直近2年）`;
  if (stats.n === 0) return { title, main: "出走なし", sub: null };
  if (stats.n < SMALL_RUNS) {
    return { title, main: `${stats.n}走中1着${stats.win}回`, sub: `2着以内${stats.top2}回` };
  }
  return {
    title,
    main: `1着 ${pct1(stats.win, stats.n)}%`,
    sub: `2連率 ${pct1(stats.top2, stats.n)}%・${stats.n}走`,
  };
}

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * 今節の今日より前の着（古い順）。その場の走を今日から遡り、日付の間が2日以内（中止の日を挟む）の間だけ同じ節とみなす
 * @param {Array<{date:string, finishRank:number|null, finishMark:string|null}>} venueRuns その場の走（新しい順）
 * @returns {string[]|null} 今日より前の走が無ければ null（初日）
 */
export function meetFinishes(venueRuns, today) {
  const picked = [];
  let prev = today;
  for (const run of venueRuns ?? []) {
    if (run.date >= today) continue;
    if (dayDiff(prev, run.date) > 2) break;
    picked.push(run.finishRank != null ? String(run.finishRank) : (run.finishMark ?? "-"));
    prev = run.date;
  }
  return picked.length ? picked.reverse() : null;
}
