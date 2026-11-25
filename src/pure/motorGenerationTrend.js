/**
 * モーターの推移の線（今の世代＝会場の入れ替えの後だけ。オーナー 2026-11-25 承認のモック改訂2）。
 * 2連率・3連率は公式の累積（race_entries.motor_2rate/3rate、節ごとに変わる）を節の初日の点で描く。
 * 直近 N 走の窓の率は公式と当てる力が同じで、上下の7〜9割が偶然なので描かない。
 * 展示タイムは直近30走の平均（24走から）。根拠は docs/design/indicator-parts/analysis/motor-trend-window.md
 */

// 描き始めの走数（目安。偶然の幅 ±21pt の N20 に合わせた。閾値に折れ目は無い）
export const MOTOR_RATE_MIN_RUNS = 20;
export const MOTOR_EXHIBITION_WINDOW = 30;
export const MOTOR_EXHIBITION_MIN_RUNS = 24;
// 前の走からこの日数以上あいたら別の節とみなす（同じ会場の節は続けて開かれない日が挟まる）
const MEET_GAP_DAYS = 2;

const RATE_KEY = { top2Rate: "motor2Rate", top3Rate: "motor3Rate" };
const dayOf = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const sortRuns = (runs) =>
  [...(runs ?? [])]
    .filter((r) => typeof r.raceId === "string" && typeof r.date === "string")
    .sort((a, b) => a.raceId.localeCompare(b.raceId));

/**
 * 1基の走を節に分ける。日があくか、公式の率が変わった所で区切る
 * @param {Array<{raceId:string,date:string,motor2Rate:number|null,motor3Rate:number|null}>} runs
 * @returns {Array<{start:string, runsBefore:number, first:Object}>}
 */
export function motorMeets(runs) {
  const rows = sortRuns(runs);
  const meets = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const isNew =
      !prev ||
      dayOf(r.date) - dayOf(prev.date) >= MEET_GAP_DAYS ||
      r.motor2Rate !== prev.motor2Rate ||
      r.motor3Rate !== prev.motor3Rate;
    if (isNew) meets.push({ start: r.date, runsBefore: i, first: r });
  });
  return meets;
}

/**
 * 公式の2連率・3連率の節ごとの点。前の節までの走数が minRuns に満たない節は描かない。
 * 右の端は today まで最後の値を延ばす（今の節の値は出走表と同じ）
 * @param {Array<Object>} runs 1基の今の世代の走（1走1行）
 * @param {"top2Rate"|"top3Rate"} metric
 * @param {{today:string, minRuns?:number}} opts
 * @returns {Array<{date:string, value:number, runs:number, extended:boolean}>}
 */
export function motorRateTrend(runs, metric, { today, minRuns = MOTOR_RATE_MIN_RUNS }) {
  const key = RATE_KEY[metric];
  if (!key) throw new Error(`モーターの推移を出さない指標: ${metric}`);
  const points = motorMeets(runs)
    .filter((m) => m.runsBefore >= minRuns && typeof m.first[key] === "number")
    .map((m) => ({ date: m.start, value: m.first[key], runs: m.runsBefore, extended: false }));
  const last = points[points.length - 1];
  if (last && today > last.date) {
    points.push({ ...last, date: today, runs: sortRuns(runs).length, extended: true });
  }
  return points;
}

/**
 * 展示タイムの直近 window 走の平均。展示のある走が minRuns たまってから、日ごとに最後の値を1点
 * @returns {Array<{date:string, value:number, runs:number}>}
 */
export function motorExhibitionTrend(
  runs,
  { window = MOTOR_EXHIBITION_WINDOW, minRuns = MOTOR_EXHIBITION_MIN_RUNS } = {},
) {
  const rows = sortRuns(runs).filter((r) => typeof r.exhibitionTime === "number" && r.exhibitionTime > 0);
  const byDate = new Map();
  rows.forEach((r, i) => {
    if (i + 1 < minRuns) return;
    const w = rows.slice(Math.max(0, i + 1 - window), i + 1);
    const value = w.reduce((a, x) => a + x.exhibitionTime, 0) / w.length;
    byDate.set(r.date, { date: r.date, value, runs: i + 1 });
  });
  return [...byDate.values()];
}

/**
 * 節の点の吹き出しの中身（オーナー 2026-11-25 承認のモック）。点の日に始まるその基の節の走から、乗った選手と着順を、
 * 会場の節（race_series）から期間・グレード・日数を取る。点の値（節の初日の公式の率）はその節に入る前までの累計で、
 * 選手と着順はその節の中の物
 * @param {Array<Object>} runs 1基の今の世代の走（racerName・finish つき）
 * @param {string} date 点の日（節の初日）
 * @param {Array<{start:string,end:string,days:number|null,grade:string|null,title:string|null}>} meets 会場の節
 * @param {{today?: string}} [opts] today はこのレースの日。節の終わりがこの日以降なら開催中（着順はここまでの分）
 * @returns {{start:string,end:string,days:number|null,grade:string|null,racerName:string|null,finishes:Array<number|null>,
 *   byDay:Array<{date:string, results:Array<number|string|null>}>, ongoing:boolean}|null}
 *   start は節のページ（/venue/会場/meet/初日）の初日。その日に始まる節が無ければ null。
 *   byDay は日ごとの着（公式の記号があれば記号を先に。BOA-576）。3連単の目に見えないよう日で区切って出すため
 */
export function motorMeetTip(runs, date, meets, { today = null } = {}) {
  const rows = sortRuns(runs);
  const all = motorMeets(rows);
  const k = all.findIndex((m) => m.start === date);
  if (k < 0) return null;
  const inMeet = rows.slice(all[k].runsBefore, all[k + 1]?.runsBefore ?? rows.length);
  const series = (meets ?? []).find((m) => m.start <= date && date <= m.end);
  const head = meetHeadOf(series, date, inMeet);
  return {
    ...head,
    racerName: inMeet.find((r) => r.racerName)?.racerName ?? null,
    finishes: inMeet.map((r) => r.finish ?? null),
    byDay: resultsByDay(inMeet),
    ongoing: isOngoing(series, head, today),
  };
}

// 開催中か。会場の節があれば終わりがこのレースの日以降。無ければ（節の行がまだ取れていない）、その基の最後の走が
// このレースの日かその前日なら開催中とみなす（走は前日まで続いている。ファン評価の再確認 11/25 の P2）
function isOngoing(series, head, today) {
  if (today === null) return false;
  if (series) return series.end >= today;
  return dayOf(today) - dayOf(head.end) <= 1;
}

// 会場の節（race_series）があれば期間・日数・グレードをそこから、無ければ走の日で期間を作る
function meetHeadOf(series, date, inMeet) {
  if (!series) return { start: date, end: inMeet[inMeet.length - 1].date, days: null, grade: null };
  return { start: series.start, end: series.end, days: series.days ?? null, grade: series.grade ?? null };
}

// 日ごとの着。公式の記号（F・欠 等）があれば着順より先に出す（BOA-576: F の艇が rank に入っていることがある）
function resultsByDay(inMeet) {
  const out = [];
  for (const r of inMeet) {
    const res = r.finishMark ?? r.finish ?? null;
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.results.push(res);
    else out.push({ date: r.date, results: [res] });
  }
  return out;
}
