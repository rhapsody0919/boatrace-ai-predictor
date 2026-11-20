import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { cacheControl, clearObjectMemory, isPastPath, readObject } from '../../api/_lib/analogyV16.js';

const NOW = Date.parse('2026-11-19T03:00:00Z'); // JST 12:00 の 11/19
const realFetch = globalThis.fetch;
let calls = 0;

beforeEach(() => {
  process.env.SUPABASE_URL = 'http://x.test';
  process.env.SUPABASE_SERVICE_KEY = 'k';
  clearObjectMemory();
  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(gzipSync(JSON.stringify({ n: calls })), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('isPastPath: JST の今日より前の日付だけ true', () => {
  assert.equal(isPastPath('2026-11-18/r/facts/a.json.gz', NOW), true);
  assert.equal(isPastPath('2026-11-19/r/facts/a.json.gz', NOW), false);
  assert.equal(isPastPath('pool/a.json.gz', NOW), false);
});

test('cacheControl: 過去の日付は7日、当日は従来どおり、not_saved は no-store', () => {
  assert.match(cacheControl('exhibition_ready', true, '2026-11-18-02-05', NOW), /s-maxage=604800/);
  assert.match(cacheControl('exhibition_ready', true, '2026-11-19-02-05', NOW), /s-maxage=86400/);
  assert.match(cacheControl('before_exhibition', false, '2026-11-19-02-05', NOW), /s-maxage=60,/);
  assert.equal(cacheControl('not_saved', true, '2026-11-18-02-05', NOW), 'no-store');
});

test('readObject: 過去の日付は2回目をメモリから返す。今日の物は毎回読む', async () => {
  const past = '2020-01-01/run/facts/a.json.gz';
  const a = await readObject(past);
  const b = await readObject(past);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  const today = `${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}/run/facts/a.json.gz`;
  await readObject(today);
  await readObject(today);
  assert.equal(calls, 3);
});
