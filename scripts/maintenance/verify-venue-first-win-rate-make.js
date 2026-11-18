#!/usr/bin/env node
/**
 * venueQueries2.js の getVenueFirstWinRateRanking が venues の行を makeVenue（src/pure/venueModel.js）に通すことの
 * 振る舞いの試験（DM1x venue のつなぎ）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の
 * 上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 破れの行（name が無い・avg_first_win_rate が0〜1の外）は makeVenue の RangeError で reject し（呼び手の
 *     VenueRankingChart は allSettled でこの表だけ空にする）、失敗はキャッシュに残らない（直った次の呼びで取り直す）
 *   - 今の select（code・name を含む）で正の行が make を通り、率の高い順に百分率で返る
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

const { getVenueFirstWinRateRanking } = await import("../../src/services/venueQueries2.js");

const venue = (code, rate, extra = {}) => ({
  code,
  name: `会場${code}`,
  cluster: "balanced",
  avg_first_win_rate: rate,
  avg_first_win_rate_race_count: 100,
  ...extra,
});

// 偽に無い絞り .not(列, "is", null)（この関数が使う）を neq(列, null) に置き換える。偽の共通の部品は変えない
const withNot = (q) =>
  Object.assign(q, {
    not: (col, op, val) => {
      assert.equal(op, "is");
      assert.equal(val, null);
      return withNot(q.neq(col, null));
    },
  });

function use(rows) {
  const fake = createFakeSupabase({ venues: rows }, { project: true });
  setFakeSupabase({ from: (table) => withNot(fake.from(table)) });
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("name が無い行は RangeError で reject し、失敗はキャッシュに残らない", async () => {
  use([venue(1, 0.5), venue(2, 0.6, { name: null })]);
  await assert.rejects(getVenueFirstWinRateRanking(), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /venue の name/);
    assert.match(err.message, /venue code=2/);
    return true;
  });
});

await test("avg_first_win_rate が0〜1の外の行は RangeError で reject する", async () => {
  use([venue(3, 1.2)]);
  await assert.rejects(getVenueFirstWinRateRanking(), /venue の avg_first_win_rate が0〜1でない: 1.2（venue code=3）/);
});

await test("正の行は今の select で make を通り、率の高い順に百分率で返る（失敗の後でも取り直す）", async () => {
  use([venue(1, 0.5), venue(24, 0.625), venue(5, null), venue(7, 0.7, { avg_first_win_rate_race_count: 2 })]);
  assert.deepEqual(await getVenueFirstWinRateRanking(), [
    { venue_code: 24, race_count: 100, first_win_rate: 62.5 },
    { venue_code: 1, race_count: 100, first_win_rate: 50 },
  ]);
});

console.log(`verify-venue-first-win-rate-make: ${count} 件 OK`);
