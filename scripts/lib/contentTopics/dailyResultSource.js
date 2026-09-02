/**
 * ネタ供給モジュール: 成績（当日結果）。
 * 当日レースが開催されていれば対象。開催が無い日は対象外
 * （品質低下ではなく単純にデータが存在しないための非該当、spec.md参照）。
 * 履歴管理は不要（「今日」の日付自体が一意なため重複しようがない）。
 */

import { getRaceSchedule } from "../raceSchedule.js";
import { getTodayDateJST } from "../dateUtils.js";

export const id = "daily-result";

export async function getCandidates() {
  const date = getTodayDateJST();
  const schedule = await getRaceSchedule(date);
  if (!schedule || schedule.length === 0) return [];

  return [
    {
      sourceId: id,
      topicKey: date,
      date,
      raceCount: schedule.length,
    },
  ];
}
