/** 6艇の想定コース別成績（公式の直近3期、BOA-1291）。取得・表示は呼び出し側で行う。 */
import {
  buildCourseRows,
  COURSE_RATE_MIN_ENTRIES,
} from "../../utils/racerOfficialPeriodStats.js";

import { buildTodayCourseRows } from "./courseGridStats.js";

export const SIX_BOAT_WARN_ENTRIES = { 1: 10, 2: 30, 3: 30, 4: 30, 5: 42, 6: 67 };

function assertDate(value) {
  const time = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error("日付は有効な YYYY-MM-DD で指定してください");
  }
}

/** レース日より前に集計が終わった期だけを残す。同日終了の期は含めない。 */
export function periodsBefore(rows, raceDate) {
  assertDate(raceDate);
  return (rows ?? []).filter((row) => {
    assertDate(row.calc_to);
    return row.calc_to < raceDate;
  });
}

/**
 * players: [{number, racerId}]、periodRowsByRacer: { [racerId]: racer_period_stats[] }。
 * 想定コース＝艇番。期の選択・率は選手ページと共通、差を出す件数の線だけが異なる。
 */
export function buildSixBoatCourseRows({ players, periodRowsByRacer, raceDate, baseline }) {
  assertDate(raceDate);
  return [1, 2, 3, 4, 5, 6].map((course) => {
    const player = (players ?? []).find((p) => Number(p.number) === course);
    const racerId = player?.racerId ?? null;
    const rows = racerId == null ? [] : periodRowsByRacer?.[racerId];
    const stats = buildCourseRows(periodsBefore(rows, raceDate));
    const cell = stats?.courses[course - 1];
    const entries = cell?.entries ?? 0;
    const reliability = entries < COURSE_RATE_MIN_ENTRIES
      ? "none"
      : entries < SIX_BOAT_WARN_ENTRIES[course] ? "warn" : "ok";
    const avg = baseline?.national?.[String(course)]?.winRate ?? null;
    const winRate = cell?.winRate ?? null;
    return {
      boat: course,
      racerId,
      course,
      wins: cell?.wins ?? 0,
      entries,
      winRate,
      top2Rate: cell?.top2Rate ?? null,
      top3Rate: cell?.top3Rate ?? null,
      avg,
      diff: reliability === "ok" && avg !== null ? winRate - avg : null,
      reliability,
      periods: stats?.periods ?? [],
      contiguous: stats?.contiguous ?? true,
    };
  });
}

/**
 * 当地の6艇分。scopedByRacer は呼び出し側で表示レースより前に絞った履歴。
 * 1艇ずつの当地行と同じ値を使い、取得中・失敗を正常な0走と区別する。
 */
export function buildSixBoatLocalRows({ players, scopedByRacer, venueCode, now, baseline }) {
  return [1, 2, 3, 4, 5, 6].map((course) => {
    const player = (players ?? []).find((p) => Number(p.number) === course);
    const racerId = player?.racerId ?? null;
    const records = racerId == null ? [] : scopedByRacer?.[racerId];
    const row = {
      boat: course, racerId, course, wins: null, entries: 0,
      winRate: null, top2Rate: null, top3Rate: null, avg: null, diff: null,
      reliability: records === undefined ? "loading" : "error",
      periods: [], contiguous: true,
    };
    if (records === undefined || records === null) return row;
    const local = buildTodayCourseRows(records, { venueCode, course, now })
      .find((r) => r.key === "local");
    const entries = local.n;
    const { winRate, top2Rate, top3Rate } = local.metrics;
    const reliability = entries < COURSE_RATE_MIN_ENTRIES
      ? "none"
      : entries < SIX_BOAT_WARN_ENTRIES[course] ? "warn" : "ok";
    const avg = baseline?.venue?.byCourse?.[String(course)]?.winRate ?? null;
    return {
      ...row,
      wins: entries === 0 ? 0 : Math.round(winRate * entries / 100),
      entries, winRate, top2Rate, top3Rate, avg, reliability,
      diff: reliability === "ok" && avg !== null ? winRate - avg : null,
    };
  });
}
