#!/usr/bin/env node
/**
 * racerQueries5.js の getRacerPageData（選手ページの見出し・メタ）が racer_profiles の行を makeRacer（src/pure/racerModel.js）に
 * 通すことの振る舞いの試験（DM1x racer のつなぎ、2本目）。偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ
 * 列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 正の行は select の列の値のまま凍結した profile で返る（級別・開催日・ニュースはそのまま）
 *   - プロフィールが無い選手は profile が null（make を通さない。「選手情報なし」の画面）
 *   - 破れの行（birth_date が実在しない日・racer_id が文字列）は makeRacer の RangeError で reject する
 *     （呼び手の RacerProfileData.js が1回取り直して失敗の画面）
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

const { getRacerPageData } = await import("../../src/services/racerQueries5.js");

const profile = (extra = {}) => ({
  racer_id: 3941,
  name: "池田浩二",
  name_kana: "いけだこうじ",
  birth_date: "1978-03-03",
  height_cm: 167,
  weight_kg: 52,
  blood_type: "O",
  branch: "愛知",
  hometown: "愛知県",
  registration_period: 81,
  grade_at_scrape: "A1",
  ...extra,
});
const entry = { racer_id: 3941, grade: "A1", race_id: "2026-11-01-02-12" };
const news = { racer_id: 3941, id: 1, title: "見出し", summary: "要約", source_url: "https://example.com/", source_name: "出典", published_at: null, created_at: "2026-11-01T00:00:00+00:00" };

function use(profiles) {
  return setFakeSupabase(
    createFakeSupabase({ racer_profiles: profiles, race_entries: [entry], racer_news: [news] }, { project: true }),
  );
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

await test("正の行は select の列のまま凍結した profile で返る", async () => {
  use([profile()]);
  const out = await getRacerPageData(3941);
  assert.deepEqual({ ...out.profile }, {
    racer_id: 3941,
    name: "池田浩二",
    name_kana: "いけだこうじ",
    birth_date: "1978-03-03",
    height_cm: 167,
    weight_kg: 52,
    blood_type: "O",
    branch: "愛知",
    hometown: "愛知県",
    registration_period: 81,
  });
  assert.ok(Object.isFrozen(out.profile), "profile が凍結されていない");
  assert.equal(out.grade, "A1");
  assert.equal(out.latestRaceDate, "2026-11-01");
  assert.equal(out.news.length, 1);
});

await test("プロフィールが無い選手は profile が null", async () => {
  use([]);
  const out = await getRacerPageData(3941);
  assert.equal(out.profile, null);
  assert.equal(out.grade, "A1");
});

await test("birth_date が実在しない日の行は RangeError で reject する", async () => {
  use([profile({ birth_date: "1978-02-30" })]);
  await assert.rejects(getRacerPageData(3941), (err) => {
    assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
    assert.match(err.message, /racer の birth_date が YYYY-MM-DD の実在する日でない: 1978-02-30（racer_id=3941）/);
    return true;
  });
});

await test("name が文字列でない行は RangeError で reject する", async () => {
  use([profile({ name: null })]);
  await assert.rejects(getRacerPageData(3941), /racer の name が文字列でない: null（racer_id=3941）/);
});

console.log(`verify-racer-profile-make: ${count} 件 OK`);
