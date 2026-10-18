// 自動送信ページ（/admin/sns-hub/auto）の振り分け。待ち行列の行を「要対応」「今日」に分ける純粋関数
import {
  calendarDay,
  calendarRowDay,
  calendarState,
} from "./snsMonthCalendar.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// 失敗・保留・失効は直近3日（今日・昨日・一昨日、JST）だけを要対応にする。古い失敗が残り続けないように
export const ATTENTION_DAYS = 3;
const ATTENTION_STATES = ["failed", "held"];

export function todayDay(now) {
  return calendarDay(new Date(now).toISOString());
}

// 一覧の並びに使う時刻。カレンダーと同じく、公開済みは実公開、それ以外は予定（無ければ締切・期限）
export function rowTime(row) {
  return row.state === "posted"
    ? row.posted_at
    : row.scheduled_at || row.deadline_at || row.expires_at;
}

const byTime = (a, b) =>
  (Date.parse(rowTime(a)) || Infinity) - (Date.parse(rowTime(b)) || Infinity);

export function needsAttention(row, now) {
  // 要照合は再送禁止のまま照合を待つので、日付に関係なく残す
  if (row.state === "reconcile") return true;
  const day = calendarRowDay(row);
  const oldest = calendarDay(
    new Date(now - (ATTENTION_DAYS - 1) * DAY_MS).toISOString(),
  );
  if (!day || day < oldest || day > todayDay(now)) return false;
  if (ATTENTION_STATES.includes(row.state)) return true;
  // 送れないまま期限を過ぎたもの。承認の失効（cancelled）は人の操作の結果なので含めない
  return row.state !== "cancelled" && calendarState(row, now) === "expired";
}

export function attentionRows(rows, now) {
  return rows.filter((row) => needsAttention(row, now)).sort(byTime);
}

export function rowsOfDay(rows, day) {
  return rows.filter((row) => calendarRowDay(row) === day).sort(byTime);
}
