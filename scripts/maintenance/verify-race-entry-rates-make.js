#!/usr/bin/env node
/**
 * raceQueries.js の getRaceEntryOfficialRatesBreakdown（基本情報タブの勝率・連対率、F数バッジ、考えるアシスト）が race_entries の行を
 * makeRaceEntry（src/pure/raceModel.js）に通すことの振る舞いの試験（DM1x race のつなぎ、A 群）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - select は今までの9列のまま（録画の URL を変えない）。race_id は eq の値を行に付ける
 *   - 正の行は値を変えずに凍結した行で艇番順に返る（race_id が足されるだけ）。行が無いときは空の配列
 *   - 破れ（艇番が1〜6の外・race_id の形が違う）は makeRaceEntry の RangeError で reject する（呼び手の catch で取得失敗の表示）。
 *     失敗はキャッシュに残らない
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

const { getRaceEntryOfficialRatesBreakdown } = await import("../../src/services/raceQueries.js");

const SELECT =
  "boat_number, win_rate, local_win_rate, global_2rate, local_2rate, global_3rate, local_3rate, f_count, l_count";
const RACE = "2026-11-10-04-05";
const entry = (boat, extra = {}) => ({
  race_id: RACE,
  boat_number: boat,
  win_rate: 6.12,
  local_win_rate: 5.5,
  global_2rate: 41.2,
  local_2rate: null,
  global_3rate: 60.1,
  local_3rate: 55,
  f_count: boat === 2 ? 1 : 0,
  l_count: 0,
  player_name: "読まない列",
  ...extra,
});

function use(rows) {
  return setFakeSupabase(createFakeSupabase({ race_entries: rows }, { project: true }));
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("艇番が1〜6の外の行は RangeError で reject する", async () => {
  use([entry(1), entry(7)]);
  await assert.rejects(getRaceEntryOfficialRatesBreakdown(RACE), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /race の艇番が1〜6でない: 7/);
    assert.match(err.message, /race_id=2026-11-10-04-05/);
    return true;
  });
});

await test("race_id の形が違う引数は RangeError で reject する", async () => {
  const bad = "2026-11-10-4-5";
  use([entry(1, { race_id: bad })]);
  await assert.rejects(getRaceEntryOfficialRatesBreakdown(bad), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /race_id が YYYY-MM-DD-VV-RR の形でない/);
    return true;
  });
});

await test("行が無いときは空の配列", async () => {
  use([]);
  assert.deepEqual(await getRaceEntryOfficialRatesBreakdown("2026-11-11-04-05"), []);
});

await test("正の行は艇番順に凍結した行で返り、select は9列のまま（直前の破れはキャッシュに残らない）", async () => {
  const fake = use([entry(3), entry(1), entry(2)]);
  const out = await getRaceEntryOfficialRatesBreakdown(RACE);
  assert.deepEqual(fake.queriesOn("race_entries").map((q) => q.select), [SELECT]);
  assert.deepEqual(out.map((r) => r.boat_number), [1, 2, 3]);
  for (const r of out) assert.ok(Object.isFrozen(r), `行が凍結されていない: 艇番 ${r.boat_number}`);
  const { player_name: _skip, ...expected } = entry(2);
  assert.deepEqual({ ...out[1] }, expected);
});

console.log(`verify-race-entry-rates-make: ${count} 件 OK`);
