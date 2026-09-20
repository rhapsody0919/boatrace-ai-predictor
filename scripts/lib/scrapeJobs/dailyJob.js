/**
 * 日次ジョブの共通部分（plan.md §4.3）。
 *
 * GitHub Actionsのscheduleは定刻より数時間遅れ、実行時刻から「今日」を決めるジョブが、日付を取り違えて
 * 0件を書いていた（racer_series_points・venue_entry_course_stats。G1・G2）。日次ジョブの対象日は、
 * 実行時刻ではなく「ジョブの指定時刻」から解決する。補足の起動を重ねても、対象日の成功済みなら何もしない
 * （scrape_job_state.last_target_date による冪等）。
 */
import { jstMinutesOfDay, toJstDateString } from "./time.js";

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 「now 以前で最も近い、JSTの指定時刻」の日付（YYYY-MM-DD）。
 *
 * 例: 指定 22:00 のジョブが、
 *   - 当日 22:30 に起動 → 当日
 *   - 翌日 01:30 に起動（GitHub Actionsのように遅れた場合） → 前日（対象日は前日のまま）
 *   - 当日 21:59 に起動 → 前日
 *
 * @param {Date} now
 * @param {string} targetTimeJst HH:MM（JST）
 * @returns {string}
 */
export function resolveTargetDate(now, targetTimeJst) {
  const m = HHMM_RE.exec(targetTimeJst);
  if (!m) throw new Error(`指定時刻が HH:MM ではありません: ${targetTimeJst}`);
  const targetMinutes = Number(m[1]) * 60 + Number(m[2]);
  const today = toJstDateString(now);
  if (jstMinutesOfDay(now) >= targetMinutes) return today;
  return toJstDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}
