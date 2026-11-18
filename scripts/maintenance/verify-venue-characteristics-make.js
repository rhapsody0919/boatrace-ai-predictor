#!/usr/bin/env node
/**
 * venueQueries.js の getVenueCharacteristics が venues の行を makeVenue（src/pure/venueModel.js）に通すことの
 * 振る舞いの試験（DM1x venue のつなぎ）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の
 * 上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 破れの行（name が無い・cluster が3値の外）は makeVenue の RangeError で reject し（呼び手の思考アシストは
 *     取得失敗の表示）、失敗はキャッシュに残らない（直った次の呼びで取り直す）
 *   - 今の select（code・name を含む）で正の行が make を通り、cluster が返る
 *   - venues に行が無い会場は今までどおり null
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

const { getVenueCharacteristics } = await import("../../src/services/venueQueries.js");

const venue = (code, extra = {}) => ({
  code,
  name: `会場${code}`,
  water_type: "sea",
  cluster: "in_strong",
  avg_first_win_rate: 0.55,
  ...extra,
});

function use(rows) {
  setFakeSupabase(createFakeSupabase({ venues: rows }, { project: true }));
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("name が無い行は RangeError で reject し、失敗はキャッシュに残らない", async () => {
  use([venue(20, { name: null })]);
  await assert.rejects(getVenueCharacteristics(20), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /venue の name/);
    assert.match(err.message, /venue code=20/);
    return true;
  });
});

await test("cluster が3値の外の行は RangeError で reject する", async () => {
  use([venue(21, { cluster: "cluster-21" })]);
  await assert.rejects(getVenueCharacteristics(21), /venue の cluster/);
});

await test("正の行は今の select で make を通り、cluster と公式の水質・干満差を返す（失敗の後でも取り直す）", async () => {
  use([venue(20, { cluster: "out_strong" }), venue(21)]);
  assert.deepEqual(await getVenueCharacteristics(20), {
    waterType: "sea",
    tidal: true,
    cluster: "out_strong",
  });
  assert.equal((await getVenueCharacteristics(21)).cluster, "in_strong");
});

await test("venues に行が無い会場は null", async () => {
  use([]);
  assert.equal(await getVenueCharacteristics(5), null);
});

console.log(`verify-venue-characteristics-make: ${count} 件 OK`);
