/**
 * 選手の成績の「推移の線」（直近 N 走ごとの移動）を作る（2026-11-24 オーナー決定、モック改訂3）。
 * 窓は 30 走で固定する。30 走未満の窓は動きの大半が偶然で、上下を調子と読ませるため
 * （docs/design/indicator-parts/analysis/racer-form-window.md）。偶然の幅の帯は付けない（オーナー決定）。
 * 横は走の順。点ごとに前の点からの空き日数を持たせ、長い休みの印に使う。
 */
import { computeRates } from "./basicInfoStats.js";

export const TREND_WINDOW = 30;
export const TREND_MAX_POINTS = 60;
// 休みの印を付ける空きの日数（目安。根拠なし）
export const TREND_GAP_DAYS = 30;
// 推移を出す指標。勝率は公式の期ごとの値で別に出す
export const TREND_METRICS = ["top2Rate", "top3Rate", "avgSt"];

const dayOf = (raceId) => Date.parse(`${raceId.slice(0, 10)}T00:00:00Z`);

/**
 * @param {Array<Object>|null|undefined} records 1選手の走（raceId の昇順。getRacerScopedRaceStats の形）
 * @param {"top2Rate"|"top3Rate"|"avgSt"} metric
 * @returns {Array<{raceId:string, date:string, value:number, gapDays:number|null}>}
 *   古い順。窓に満たなければ空。平均ST は ST のある走だけで窓を数える（フライング等は除かれている）
 */
export function trendSeries(records, metric, { window = TREND_WINDOW, maxPoints = TREND_MAX_POINTS } = {}) {
  if (!TREND_METRICS.includes(metric)) throw new Error(`推移を出さない指標: ${metric}`);
  const rows = (records ?? []).filter(
    (r) => typeof r.raceId === "string" && (metric !== "avgSt" || (r.startTiming !== null && r.startTiming !== undefined)),
  );
  const points = [];
  for (let i = window - 1; i < rows.length; i += 1) {
    const rates = computeRates(rows.slice(i - window + 1, i + 1));
    points.push({ raceId: rows[i].raceId, date: rows[i].raceId.slice(0, 10), value: rates[metric] });
  }
  return points.slice(-maxPoints).map((p, i, arr) => ({
    ...p,
    gapDays: i === 0 ? null : Math.round((dayOf(p.raceId) - dayOf(arr[i - 1].raceId)) / 86400000),
  }));
}

/** 休みの印を付ける点（前の点から TREND_GAP_DAYS 日以上空いた点）の添字 */
export function trendGapIndexes(points, gapDays = TREND_GAP_DAYS) {
  return points.flatMap((p, i) => (p.gapDays !== null && p.gapDays >= gapDays ? [i] : []));
}
