#!/usr/bin/env node
/**
 * scheduleQueries.js の getMorningDigest（本日のデータ一覧 /today・共有の画像 /share/today-sheet）が morning_digest_rows の行を
 * makeDigestRow（src/pure/scheduleModel.js）に通すことの振る舞いの試験（DM1x schedule のつなぎ、A 群）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 正の行は値を変えずに凍結して節ごとに返る（select で取った他の列 detail 等も落とさない）
 *   - 破れの行（racer_id が null・returned なのに race_id がある・節が不明・rank が0・注目の数値が null・艇番が7）は
 *     makeDigestRow の RangeError で reject する（呼び手 MorningDataDigest.jsx・TodaySheet.jsx の catch で取得失敗の表示）。
 *     失敗はキャッシュに残らない
 *   - 未生成（generated_at が null）の日は rows を使わないので、行が破れていても not_generated で返る
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
const dayRow = (date, extra = {}) => ({
  digest_date: date,
  generated_at: `${date}T05:30:00+00:00`,
  venue_count: 12,
  race_count: 144,
  flying_data_complete: true,
  suppressed_venues: [],
  ...extra,
});
const featuredRow = (date, rank, extra = {}) => ({
  digest_date: date,
  section: "featured",
  rank,
  race_id: "202609221605",
  race_number: 5,
  boat_number: 1,
  course: 1,
  venue_code: 16,
  racer_id: 3941,
  racer_name: "池田浩二",
  is_small_sample: false,
  metric_value: 80,
  metric_expected: 60,
  metric_skill_delta: 20,
  metric_venue_baseline: 55,
  metric_predicted: 70,
  sample_size: 40,
  detail: { from: "nige" },
  ...extra,
});
const returnedRow = (date, rank, extra = {}) => ({
  digest_date: date,
  section: "returned",
  rank,
  race_id: null,
  race_number: null,
  boat_number: null,
  course: null,
  venue_code: 2,
  racer_id: 4320,
  racer_name: "峰竜太",
  is_small_sample: false,
  detail: { reason: "帰郷（公傷のため）" },
  ...extra,
});

/** 偽の supabase に2表の行を置く（select で頼んだ列だけ返す） */
const use = (days, rows) =>
  setFakeSupabase(createFakeSupabase({ morning_digest_days: days, morning_digest_rows: rows }, { project: true }));

// 試験は順に回す（キャッシュの有無を順で見るため）。数は最後に出す
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

const BROKEN = [
  ["racer_id が null", (d) => featuredRow(d, 1, { racer_id: null }), /digest_row の racer_id/],
  ["returned なのに race_id がある", (d) => returnedRow(d, 1, { race_id: "202609221605" }), /digest_row の race_id が節の決まり/],
  ["節が不明", (d) => featuredRow(d, 1, { section: "unknown" }), /digest_row の section/],
  ["rank が0", (d) => featuredRow(d, 0), /digest_row の rank/],
  ["注目の metric_value が null", (d) => featuredRow(d, 1, { metric_value: null }), /digest_row の metric_value が null/],
  ["艇番が7", (d) => featuredRow(d, 1, { boat_number: 7 }), /digest_row の boat_number/],
];

// 破れの試験はそれぞれ別の日付で引く（成功はキャッシュに残るため。失敗が残らないことは最後の正の試験で見る）
for (const [i, [label, build, message]] of BROKEN.entries()) {
  const date = `2026-09-${String(10 + i).padStart(2, "0")}`;
  test(`${label}の行は RangeError で reject する`, async () => {
    use([dayRow(date)], [featuredRow(date, 2), build(date)]);
    await assert.rejects(getMorningDigest(date), (err) => {
      assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
      assert.match(err.message, message);
      assert.match(err.message, new RegExp(`digest_date=${date}`));
      return true;
    });
  });
}

test("未生成の日は行が破れていても not_generated で返る（rows を使わない）", async () => {
  const date = "2026-09-20";
  use([dayRow(date, { generated_at: null })], [featuredRow(date, 1, { racer_id: null })]);
  const out = await getMorningDigest(date);
  assert.equal(out.state, "not_generated");
  assert.deepEqual(out.sections, {});
});

test("正の行は値のまま凍結して節ごとに返る（直前の破れはキャッシュに残らない）", async () => {
  const rows = [featuredRow(DATE, 2), featuredRow(DATE, 1), returnedRow(DATE, 1)];
  // 最初の破れの試験と同じ日付の失敗が残っていないことも見る
  const first = "2026-09-10";
  use([dayRow(DATE), dayRow(first)], [...rows, featuredRow(first, 1)]);
  const out = await getMorningDigest(DATE);
  assert.equal(out.state, "generated");
  assert.deepEqual(out.sections.featured.map((r) => r.rank), [1, 2]);
  assert.deepEqual({ ...out.sections.featured[0] }, featuredRow(DATE, 1));
  assert.deepEqual({ ...out.sections.returned[0] }, returnedRow(DATE, 1));
  for (const row of [...out.sections.featured, ...out.sections.returned]) {
    assert.ok(Object.isFrozen(row), `行が凍結されていない: ${row.section} ${row.rank}`);
  }
  assert.deepEqual(out.sections.nige, []);
  const again = await getMorningDigest(first);
  assert.equal(again.state, "generated");
  assert.equal(again.sections.featured.length, 1);
  assert.ok(Object.isFrozen(again.sections.featured[0]), "前に失敗した日の行が凍結されていない");
});

for (const { name, fn } of cases) {
  await fn();
  console.log(`ok - ${name}`);
}
console.log(`verify-morning-digest-rows-make: ${cases.length} 件 OK`);
