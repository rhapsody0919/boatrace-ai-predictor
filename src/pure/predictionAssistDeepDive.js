/**
 * predictionAssistDeepDive - 思考アシストの深掘りの部品（今節の各走・前の5走・コースの1着・着の色と点・会場の成績の無い艇・得意の決まり手の札）。
 * src/utils/assistSummary.js から字のまま移した（外へ出す名は assistSummary が再 export する）
 */
import {
  buildMeetResults,
  finishPositionOf,
  recordsBeforeRace,
} from "./basicInfoStats.js";
import { SCORE_POINTS } from "./seriesPoints.js";

// ---- 深掘り（FR-5・D-29・D-36 (10)(11)）----

/** 1走の着（1〜6）。着が無い（欠場・失格等）は null */
export const finishOf = (run) => finishPositionOf(run);

/** 1走の点。着があれば着順点、欠場は null（走数に入れない）、F・L・失格・転覆など走って着の無い走は0点 */
const pointsOf = (run) => {
  const f = finishOf(run);
  if (f != null) return SCORE_POINTS[f];
  return run.absent ? null : 0;
};

/**
 * 今節の各走（表示中のレースより前、同じ会場・同じ節）。今日の走は点に入れない（D-29）
 * @param {object[]} records getRacerScopedRaceStats の戻り値
 * @param {string} raceId 表示中のレース
 * @returns {{past: object[], today: object[], sum: number, count: number, avg: number|null, byDay: Array<{date: string, finishes: Array<number|string|null>}>}}
 *   finishes は着（1〜6）か、着の無い走の公式の記号（F・失 等）
 */
export function meetRuns(records, raceId) {
  const venueCode = Number(raceId.slice(11, 13));
  const runs = buildMeetResults(records, { raceId, venueCode });
  const date = raceId.slice(0, 10);
  const past = runs.filter((r) => r.date !== date);
  const today = runs.filter((r) => r.date === date);
  // F・L・失格・転覆等は0点で走数に入れ、欠場だけ外す（v16 の今節の平均着順点・seriesPoints の規則3と同じ。
  // data-accuracy-verifier の指摘: 分母から落とすと平均が v16 の値より高く出る）
  const scored = past.filter((r) => pointsOf(r) != null);
  const sum = scored.reduce((s, r) => s + pointsOf(r), 0);
  const byDay = [];
  for (const r of past) {
    const mark = finishOf(r) ?? r.finishMark ?? null;
    const last = byDay[byDay.length - 1];
    if (last?.date === r.date) last.finishes.push(mark);
    else byDay.push({ date: r.date, finishes: [mark] });
  }
  return {
    past,
    today,
    sum,
    count: scored.length,
    avg: scored.length ? sum / scored.length : null,
    byDay,
  };
}

/** 日付 YYYY-MM-DD → 「10/2」（月・日とも0埋めしない。1走ずつの表と着順の並びで共通） */
export const monthDay = (date) => {
  const [, m, d] = String(date).split("-");
  return `${Number(m)}/${Number(d)}`;
};

/** 着の色のクラス（既存の RaceHistoryTable と同じ: 1着＝金、5・6着＝赤） */
export const finishClass = (f) =>
  f === 1 ? " ta-fin-1" : f === 5 || f === 6 ? " ta-fin-bad" : "";

/** 今節の走の点（今日の走・欠場は null） */
export const runPoints = (run, today) => (today ? null : pointsOf(run));

/**
 * 今節より前の5走（新しい順）。今節の走と表示中のレースより後の走を除いてから5走（D-36 (10)）
 * @param {object[]} records
 * @param {string} raceId
 * @param {object[]} meet meetRuns の past と today
 */
export function priorRuns(records, raceId, meet) {
  const ids = new Set(meet.map((r) => r.raceId));
  return (recordsBeforeRace(records ?? [], raceId) ?? [])
    .filter((r) => !ids.has(r.raceId))
    .slice(-5)
    .reverse();
}

/**
 * そのコースで走ったときの1着（進入コースで数える。D-36 (11)。表示中のレースより前、直近2年）
 * @returns {{k: number, n: number}}
 */
export function courseWins(records, raceId, course) {
  const runs = (recordsBeforeRace(records ?? [], raceId) ?? []).filter(
    (r) => r.actualCourse === course && finishOf(r) != null,
  );
  return { k: runs.filter((r) => finishOf(r) === 1).length, n: runs.length };
}

// 会場の成績が無い（0 件、または値が欠けている）艇か
const hasNoLocWin = (today, boat) => {
  const loc = today?.items?.loc_win?.values?.[boat - 1];
  return loc === 0 || (today?.items?.loc_win && loc == null);
};

// 得意の決まり手の札（逃げ以外の最多が、勝ち8回以上のうち3割以上のとき）
const techChip = (technique) => {
  const top = technique?.techniques?.[0];
  if (
    top &&
    top.technique !== "逃げ" &&
    technique.win_count >= 8 &&
    top.count / technique.win_count >= 0.3
  )
    return {
      id: "tech",
      technique: top.technique,
      wins: technique.win_count,
      count: top.count,
    };
  return null;
};

export { hasNoLocWin, techChip };
