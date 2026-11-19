#!/usr/bin/env node
/**
 * scheduleQueries.js の getUpcomingSeries（トップの会場グリッドの次開催日）が race_series の行を makeMeet（src/pure/meetModel.js）に、
 * getTodaysRacesForVenue（分析の会場・レースの選び）が races の行を makeRace（src/pure/raceModel.js）に通すことの振る舞いの試験
 * （DM1x schedule のつなぎ、A 群）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上で
 * サービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - getUpcomingSeries: select に total_days・class_code・kind を足した。正の行は凍結して値のまま。破れ（total_days が日程と合わない・
 *     class_code が不明）は makeMeet の RangeError で reject（呼び手 VenueGridPage の catch で次開催日だけ出さない）
 *   - getTodaysRacesForVenue: select は3列のまま（録画の URL を変えない）、venue_code は eq の値を行に付ける。正の行は凍結。
 *     破れ（race_id の会場と引いた会場が食い違う・レース番号が race_id と食い違う）は makeRace の RangeError で reject
 *   - 失敗はキャッシュに残らない
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

const { getUpcomingSeries, getTodaysRacesForVenue } = await import("../../src/services/scheduleQueries.js");

const TODAY_JST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const meet = (venue, start, end, extra = {}) => ({
  venue_code: venue,
  start_date: start,
  end_date: end,
  total_days: (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1,
  class_code: "G1",
  kind: "g1",
  title: "読まない列",
  ...extra,
});
const race = (venue, no, extra = {}) => ({
  race_id: `${TODAY_JST}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`,
  race_date: TODAY_JST,
  venue_code: venue,
  race_number: no,
  start_time: "15:30:00",
  ...extra,
});

const use = (tables) => setFakeSupabase(createFakeSupabase(tables, { project: true }));

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

async function rejectsWith(promise, message) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, message);
    return true;
  });
}

// ---- getUpcomingSeries ----
await test("節: total_days が日程と合わない行は RangeError で reject する", async () => {
  use({ race_series: [meet(16, "2026-09-28", "2026-10-03"), meet(4, "2026-10-01", "2026-10-06", { total_days: 5 })] });
  await rejectsWith(getUpcomingSeries("2026-09-20"), /meet の total_days が end_date - start_date \+ 1 と違う: 5（期待 6、meet venue_code=4/);
});

await test("節: class_code が不明な行は RangeError で reject する", async () => {
  use({ race_series: [meet(16, "2026-09-28", "2026-10-03", { class_code: "G9" })] });
  await rejectsWith(getUpcomingSeries("2026-09-21"), /meet の class_code が不明な値: G9/);
});

await test("節: 正の行は凍結して値のまま返り、select は6列（直前の破れはキャッシュに残らない）", async () => {
  const fake = use({ race_series: [meet(4, "2026-10-01", "2026-10-06"), meet(16, "2026-09-28", "2026-10-03"), meet(5, "2026-09-01", "2026-09-06")] });
  const out = await getUpcomingSeries("2026-09-20");
  assert.deepEqual(fake.queriesOn("race_series").map((q) => q.select), ["venue_code,start_date,end_date,total_days,class_code,kind"]);
  assert.deepEqual(out.map((r) => r.venue_code), [16, 4]);
  for (const r of out) assert.ok(Object.isFrozen(r), `行が凍結されていない: ${r.venue_code}`);
  const { title: _skip, ...expected } = meet(16, "2026-09-28", "2026-10-03");
  assert.deepEqual({ ...out[0] }, expected);
});

// ---- getTodaysRacesForVenue ----
await test("本日のレース: race_id の会場と引いた会場が食い違う行は RangeError で reject する", async () => {
  // 会場 7 で引いて race_id が会場 6 の行（行の会場は eq の値 7 になり、race_id との食い違いで落ちる）
  use({ races: [race(7, 1), { ...race(6, 2), venue_code: 7 }] });
  await rejectsWith(getTodaysRacesForVenue(7), /race の race_id と会場コードが食い違う: 7/);
});

await test("本日のレース: レース番号が race_id と食い違う行は RangeError で reject する", async () => {
  use({ races: [race(8, 3, { race_number: 4 })] });
  await rejectsWith(getTodaysRacesForVenue(8), /race の race_id とレース番号が食い違う: 4/);
});

await test("本日のレース: 正の行はレース番号順に凍結して返り、select は3列のまま・会場が付く（直前の破れはキャッシュに残らない）", async () => {
  const fake = use({ races: [race(7, 2), race(7, 1), race(6, 1)] });
  const out = await getTodaysRacesForVenue(7);
  assert.deepEqual(fake.queriesOn("races").map((q) => q.select), ["race_id, race_number, start_time"]);
  assert.deepEqual(out.map((r) => r.race_number), [1, 2]);
  for (const r of out) assert.ok(Object.isFrozen(r), `行が凍結されていない: ${r.race_id}`);
  const { race_date: _skip, ...expected } = race(7, 1);
  assert.deepEqual({ ...out[0] }, expected);
});

console.log(`verify-schedule-series-races-make: ${count} 件 OK`);
