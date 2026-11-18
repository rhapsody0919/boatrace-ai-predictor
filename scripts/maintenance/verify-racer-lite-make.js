#!/usr/bin/env node
/**
 * racerQueries.js の getAllRacersLite が racer_profiles の行を makeRacer（src/pure/racerModel.js）に通すことの
 * 振る舞いの試験（DM1x racer のつなぎ）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の
 * 上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 正の行は値を変えずに凍結した行で返り、getAllRacersWithGrade は級別・勝率を足した写しを返す
 *   - 破れの行（racer_id が文字列・birth_date が無い）は makeRacer の RangeError で reject し（呼び手の catch で
 *     取得失敗の表示）、失敗はキャッシュに残らない（直った次の呼びで取り直す）
 *   - 今の select（racer_id・name・birth_date を含む）で 1000 行のページを越えても全件が make を通る
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

const { getAllRacersLite, getAllRacersWithGrade } = await import("../../src/services/racerQueries.js");

const racer = (id, extra = {}) => ({
  racer_id: id,
  name: `選手${id}`,
  name_kana: "せんしゅ",
  branch: "東京",
  height_cm: 170,
  weight_kg: 52,
  registration_period: 100,
  hometown: "東京都",
  birth_date: "1990-01-01",
  grade_at_scrape: "A1",
  ...extra,
});

/** 表を差し替える。成功した取得はキャッシュ（all-racers-lite-v2）に残るので、破れの試験を先に、成功の試験は最後に1回だけ置く */
function use(profiles, grades = []) {
  return setFakeSupabase(
    createFakeSupabase(
      { racer_profiles: profiles, racer_grade_cache: [{ key: "latest_grades", data: grades }] },
      { project: true, maxRows: 1000 },
    ),
  );
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("racer_id が文字列の行は RangeError で reject し、失敗はキャッシュに残らない", async () => {
  use([racer(4001), racer("4002")]);
  await assert.rejects(getAllRacersLite(), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /racer の racer_id が-2147483648〜2147483647でない: 4002（racer_id=4002）/);
    return true;
  });
});

await test("birth_date が無い行は RangeError で reject する", async () => {
  use([racer(4001, { birth_date: null })]);
  await assert.rejects(getAllRacersLite(), /racer の birth_date が YYYY-MM-DD の実在する日でない: null（racer_id=4001）/);
});

await test("1000 行を越えるページも全件が make を通り、select の列のまま凍結した行で返る（失敗の後でも取り直す）", async () => {
  use(
    Array.from({ length: 1500 }, (_, i) => racer(3000 + i, i === 1 ? { birth_date: "1985-12-31" } : {})),
    [{ racer_id: 3000, grade: "A1", win_rate: 7.5 }],
  );
  const out = await getAllRacersLite();
  assert.equal(out.length, 1500);
  assert.deepEqual({ ...out[1] }, {
    racer_id: 3001,
    name: "選手3001",
    name_kana: "せんしゅ",
    branch: "東京",
    height_cm: 170,
    weight_kg: 52,
    registration_period: 100,
    hometown: "東京都",
    birth_date: "1985-12-31",
  });
  assert.ok(out.every((r) => Object.isFrozen(r)), "行が凍結されていない");
});

await test("getAllRacersWithGrade は凍結した行の写しに級別・勝率を足す", async () => {
  const out = await getAllRacersWithGrade();
  assert.equal(out.length, 1500);
  assert.equal(out[0].grade, "A1");
  assert.equal(out[0].winRate, 7.5);
  assert.equal(out[1].grade, null);
  assert.equal(out[1].winRate, null);
  assert.equal(Object.isFrozen(out[0]), false);
});

console.log(`verify-racer-lite-make: ${count} 件 OK`);
