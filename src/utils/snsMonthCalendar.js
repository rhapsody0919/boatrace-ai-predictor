import { getJSTNow } from './dateUtils.js';

export const UNKNOWN_CALENDAR_VALUE = '未確認';
export function calendarDay(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return getJSTNow(new Date(value)).toISOString().slice(0, 10);
}
export function calendarState(row, now) {
  if (row.state === 'posted') return 'posted';
  if (row.state === 'cancelled' || (['queued', 'held', 'pending_review', 'approved'].includes(row.state) && Date.parse(row.expires_at) <= now)) return 'expired';
  if (row.state === 'queued') return 'planned';
  return 'other';
}
export function calendarRowDay(row) {
  return calendarDay(row.state === 'posted' ? row.posted_at : row.scheduled_at || row.deadline_at || row.expires_at);
}
export function calendarVenue(row) {
  const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})-\d{2}$/.exec(row.race_id || '');
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 24 ? match[2] : UNKNOWN_CALENDAR_VALUE;
}
export function calendarMonth(rows, month, { format = '', venue = '' } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  return rows.filter(row => calendarRowDay(row)?.startsWith(month) && (!format || (row.format || UNKNOWN_CALENDAR_VALUE) === format) && (!venue || calendarVenue(row) === venue));
}
export function monthDays(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}
// 取得済みの履歴のみ。値・期間の合算や、欠測の0埋めはしない。
export function calendarObservations(row, now) {
  return (row.observations || []).filter(o => o.source !== 'mock' && Date.parse(o.observed_at) <= now);
}
