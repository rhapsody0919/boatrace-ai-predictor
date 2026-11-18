#!/usr/bin/env node
/**
 * scheduleQueries.js の getMorningDigest（本日のデータ一覧 /today・共有の画像 /share/today-sheet）が morning_digest_days の行を
 * makeDigestDay（src/pure/scheduleModel.js）に通すことの振る舞いの試験（DM1x schedule のつなぎ）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 正の行は値を変えずに凍結した day で返り、rows は節ごとに分かれる（今までどおり）
 *   - その日の行が無いときは not_generated で day は null（make を通さない）。generated_at が null の行は not_generated で day は凍結した行
 *   - 破れの行（window_end が window_start より前・race_count が負・suppressed_venues が配列でない）は makeDigestDay の
 *     RangeError で reject する（呼び手 MorningDataDigest.jsx・TodaySheet.jsx の catch で取得失敗の表示）。失敗はキャッシュに残らない
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();
installLocalStorage();

const { getMorningDigest } = await import("../../src/services/scheduleQueries.js");

const DATE = "2026-09-22";
const dayRow = (extra = {}) => ({
  digest_date: DATE,
  generated_at: `${DATE}T05:30:00+00:00`,
  venue_count: 12,
  race_count: 144,
  window_start: "2025-12-02",
  window_end: "2026-09-21",
  window_days: 294,
  flying_data_complete: true,
  suppressed_venues: [3],
  notes: { courseWin: [] },
  ...extra,
});
const digestRow = (section, rank, extra = {}) => ({
  digest_date: DATE,
  section,
  rank,
  race_id: "2026-09-22-16-05",
  race_number: 5,
  boat_number: 1,
  venue_code: 16,
  racer_id: 3941,
  racer_name: "池田浩二",
  ...extra,
});

function use(days, rows = []) {
  return setFakeSupabase(
    createFakeSupabase({ morning_digest_days: days, morning_digest_rows: rows }, { project: true }),
  );
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const BROKEN = [
  ["window_end が window_start より前", { window_end: "2025-12-01" }, /digest_day の window_end が window_start より前/],
  ["race_count が負", { race_count: -1 }, /digest_day の race_count/],
  ["suppressed_venues が配列でない", { suppressed_venues: "3" }, /digest_day の suppressed_venues が配列でない/],
];

// 破れ・行なしの試験はそれぞれ別の日付で引く（成功はキャッシュに残るため。失敗が残らないことは最後の正の試験で見る）
for (const [label, extra, message] of BROKEN) {
  await test(`${label}の行は RangeError で reject する`, async () => {
    use([dayRow(extra)]);
    await assert.rejects(getMorningDigest(DATE), (err) => {
      assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
      assert.match(err.message, message);
      assert.match(err.message, /digest_date=2026-09-22/);
      return true;
    });
  });
}

await test("その日の行が無いときは not_generated で day は null", async () => {
  use([]);
  const out = await getMorningDigest("2026-09-20");
  assert.deepEqual(out, { state: "not_generated", day: null, sections: {} });
});

await test("generated_at が null の行は not_generated で day は凍結した行", async () => {
  const row = dayRow({ digest_date: "2026-09-21", generated_at: null });
  use([row]);
  const out = await getMorningDigest("2026-09-21");
  assert.equal(out.state, "not_generated");
  assert.deepEqual({ ...out.day }, row);
  assert.ok(Object.isFrozen(out.day), "day が凍結されていない");
});

await test("正の行は値のまま凍結した day で返り、rows は節ごとに分かれる（直前の破れはキャッシュに残らない）", async () => {
  const rows = [digestRow("nige", 2), digestRow("nige", 1), digestRow("featured", 1)];
  use([dayRow()], rows);
  const out = await getMorningDigest(DATE);
  assert.equal(out.state, "generated");
  assert.deepEqual({ ...out.day }, dayRow());
  assert.ok(Object.isFrozen(out.day), "day が凍結されていない");
  assert.deepEqual(out.sections.nige.map((r) => r.rank), [1, 2]);
  assert.equal(out.sections.featured.length, 1);
  assert.deepEqual(out.sections.flying, []);
});

console.log(`verify-morning-digest-day-make: ${count} 件 OK`);
