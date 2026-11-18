#!/usr/bin/env node
/**
 * meetQueries3.js の getMeetPage が race_series の行を makeMeet（src/pure/meetModel.js）に通すことの
 * 振る舞いの試験（DM1x meet のつなぎ）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の
 * 上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 破れの行（total_days が日数と違う・class_code が知らない値）は makeMeet の RangeError で reject する
 *     （呼び手 MeetPage の catch で取得失敗の表示）
 *   - 今の select（主キー・total_days・class_code・kind を含む）で正の行が make を通り、節の題・グレード・最終日に使われる
 *   - race_series に行が無い節は今までどおり null の扱い（投げない）
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();

const { getMeetPage } = await import("../../src/services/meetQueries3.js");

const START = "2026-09-28";
const series = (extra = {}) => ({
  venue_code: 16,
  start_date: START,
  end_date: "2026-10-03",
  total_days: 6,
  class_code: "G1",
  kind: "g1",
  grade: "G1",
  title: "児島キングカップ",
  updated_at: null,
  ...extra,
});

function use(rows) {
  setFakeSupabase(createFakeSupabase({ race_series: rows }, { project: true }));
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("total_days が日数と違う行は RangeError で reject する", async () => {
  use([series({ total_days: 5 })]);
  await assert.rejects(getMeetPage(16, START, "2026-09-20"), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(
      err.message,
      /meet の total_days が end_date - start_date \+ 1 と違う: 5（期待 6、meet venue_code=16 start_date=2026-09-28）/,
    );
    return true;
  });
});

await test("class_code が知らない値の行は RangeError で reject する", async () => {
  use([series({ class_code: "g1" })]);
  await assert.rejects(getMeetPage(16, START, "2026-09-20"), RangeError);
});

await test("正の行は今の select で make を通り、題・グレード・最終日に使われる", async () => {
  use([series(), series({ venue_code: 15, title: "別の会場" })]);
  const page = await getMeetPage(16, START, "2026-09-20");
  assert.equal(page.title, "児島キングカップ");
  assert.equal(page.grade, "G1");
  assert.equal(page.endDate, "2026-10-03");
  assert.equal(page.knownMeet, true);
});

await test("race_series に行が無い節は投げずに null の扱い", async () => {
  use([]);
  const page = await getMeetPage(16, START, "2026-09-20");
  assert.equal(page.title, null);
  assert.equal(page.knownMeet, false);
});

console.log(`verify-meet-page-make: ${count} 件 OK`);
