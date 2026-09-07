import { parseRaceId } from "./raceId.js";

export const DEADLINE_STATUS = {
  ACCEPTING: "accepting",
  CLOSING_SOON: "closing_soon",
  CLOSED: "closed",
};

const WARNING_WINDOW_MINUTES = 5;

/**
 * raceId ("YYYY-MM-DD-VV-RR") と startTime ("HH:MM") から締切時刻のDateを構築する。
 * JST固定（+09:00）。parseRaceId が失敗する場合は null を返す（ADR 0042）。
 */
export function getDeadlineDate(raceId, startTime) {
  const parsed = parseRaceId(raceId);
  if (!parsed || !startTime) return null;
  const iso = `${parsed.date}T${startTime}:00+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 締切ステータスを計算する。now は呼び出し側から渡す（テスト容易性のため）。
 */
export function getDeadlineStatus(raceId, startTime, now = new Date()) {
  const deadline = getDeadlineDate(raceId, startTime);
  if (!deadline) return null;
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 0) return DEADLINE_STATUS.CLOSED;
  if (diffMs <= WARNING_WINDOW_MINUTES * 60 * 1000) return DEADLINE_STATUS.CLOSING_SOON;
  return DEADLINE_STATUS.ACCEPTING;
}
