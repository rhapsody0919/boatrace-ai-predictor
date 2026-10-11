import assert from 'node:assert/strict';
import { calendarDay, calendarState, calendarRowDay, calendarVenue, calendarMonth, monthDays, calendarObservations } from '../../src/utils/snsMonthCalendar.js';
import { xSendStore } from '../../api/_lib/snsXSendStore.js';
import { build } from 'esbuild';

// 実際の入口から新しいJSX・CSS・既存importを束ねる。envファイルは読まない。
await build({ entryPoints: [new URL('../../src/pages/admin/sns-hub/DeadlineQueuePanel.jsx', import.meta.url).pathname], bundle: true, outdir: '/tmp/sns-month-calendar-bundle', write: false, platform: 'browser', jsx: 'automatic' });

const now = Date.parse('2026-10-08T01:00:00Z');
const rows = [
  { id: 'planned', channel: 'x', state: 'queued', scheduled_at: '2026-10-07T15:00:00Z', expires_at: '2026-10-08T02:00:00Z', format: 'short', race_id: '2026-10-08-01-01' },
  { id: 'posted', channel: 'youtube', state: 'posted', posted_at: '2026-09-30T15:00:00Z', scheduled_at: '2026-09-30T00:00:00Z', expires_at: '2000-01-01T00:00:00Z', format: 'normal', race_id: '2026-10-01-24-01' },
  { id: 'unknown', state: 'posted', scheduled_at: '2026-10-01T00:00:00Z' },
  { id: 'held', state: 'held', expires_at: '2026-10-08T01:00:00Z' },
  { id: 'reconcile', state: 'reconcile', expires_at: '2000-01-01T00:00:00Z' },
];
assert.equal(calendarDay('2026-09-30T15:00:00Z'), '2026-10-01');
assert.equal(calendarRowDay(rows[1]), '2026-10-01');
assert.equal(calendarRowDay(rows[2]), null, '公開日を予定日から推測しない');
assert.equal(calendarState(rows[0], now), 'planned');
assert.equal(calendarState(rows[0], Date.parse(rows[0].expires_at)), 'expired');
assert.equal(calendarState(rows[1], now), 'posted');
assert.equal(calendarState(rows[3], now), 'expired');
assert.equal(calendarState(rows[4], now), 'other', '要照合を失効へ戻さない');
assert.equal(calendarState({ state: 'cancelled' }, now), 'expired');
assert.equal(monthDays('2024-02').length, 29);
assert.equal(monthDays('2026-02').length, 28);
assert.equal(monthDays('2026-13').length, 0);
assert.equal(calendarVenue(rows[0]), '01');
assert.equal(calendarVenue({ race_id: '2026-10-08-99-01' }), '未確認');
assert.deepEqual(calendarMonth(rows, '2026-10', { format: 'short', venue: '01' }).map(row => row.id), ['planned']);
assert.deepEqual(calendarMonth(rows, '2026-10', { format: 'normal', venue: '01' }), []);
assert.deepEqual(calendarObservations({ observations: [
  { source: 'mock', observed_at: '2026-10-07T00:00:00Z' },
  { source: 'csv', observed_at: '2026-10-09T00:00:00Z' },
  { source: 'manual', observed_at: '2026-10-07T00:00:00Z', metric_value: null, missing_reason: '未収集' },
] }, now).map(o => o.metric_value), [null]);

const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async url => {
    const path = String(url).split('/rest/v1/')[1];
    const query = new URL(path, 'http://localhost').searchParams;
    calls.push({ path, query });
    if (path.startsWith('sns_x_send_jobs?')) return Response.json([{ id: 'job', draft_id: 'posted', state: 'posted', posted_at: rows[1].posted_at }]);
    if (path.startsWith('sns_drafts?')) return Response.json([
      { id: 'posted', status: 'archived', platform: 'youtube', format: 'normal', source_data: { race_id: rows[1].race_id, grade: 'SG' } },
      { id: 'hidden', status: 'archived', platform: 'x' },
    ]);
    if (path.startsWith('sns_metric_observations?')) {
      const offset = Number(query.get('offset'));
      return Response.json(Array.from({ length: offset < 1000 ? 500 : 1 }, (_, i) => ({ id: String(offset + i), draft_id: 'posted', source: 'manual', metric_value: null })));
    }
    throw new Error('未許可のテスト通信');
  };
  const result = await xSendStore.queue();
  assert.equal(result.length, 1, 'アーカイブされた投稿済みjobを表示する');
  assert.equal(result[0].posted_at, rows[1].posted_at);
  assert.equal(result[0].format, 'normal');
  assert.equal(result[0].grade, 'SG');
  assert.equal(result[0].observations.length, 1001, '1000行上限を超える観測履歴を読む');
  assert(calls.every(({ query }) => query.get('limit') === '500'));
  assert(calls.find(({ path }) => path.startsWith('sns_metric_observations')).query.get('source') === 'neq.mock');
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(xSendStore.queue, /DB操作/);
} finally { globalThis.fetch = originalFetch; }
console.log('SNS month calendar: JST, states, filters, missing dates, observation history, pagination PASS');
if (process.argv.includes('--ui')) await import('./snsMonthCalendarUi.js');
