#!/usr/bin/env node
/**
 * motorQueries2.js の fetchPretestByRacer（モータ情報タブの前検タイム、getRaceMotorBreakdown の材料）が motor_pretest_stats の行を
 * makeMotorPretest（src/pure/motorModel.js）に通すことの振る舞いの試験（DM1x motor のつなぎ、A 群）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - select は今までの4列のまま（録画の URL を変えない）。venue_code は eq の値を行に付ける
 *   - 正の行は選手ごとに最新の行が凍結した行で返る（venue_code が足されるだけ）。行が無いときは空の Map
 *   - 破れ（pretest_rank が0・pretest_time と pretest_rank の片方だけ null・race_date が実在しない日）は makeMotorPretest の
 *     RangeError で reject する（呼び手 getRaceMotorBreakdown の withCache は保存せず、画面は取得失敗）
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

const { fetchPretestByRacer } = await import("../../src/services/motorQueries2.js");

const VENUE = 5;
const DATE = "2026-09-21";
const pretest = (racerId, raceDate, extra = {}) => ({
  race_date: raceDate,
  venue_code: VENUE,
  racer_id: racerId,
  racer_class: "A1",
  motor_number: 33,
  pretest_time: 6.75,
  pretest_rank: 2,
  ...extra,
});

function use(rows) {
  return setFakeSupabase(createFakeSupabase({ motor_pretest_stats: rows }, { project: true }));
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const BROKEN = [
  ["pretest_rank が0", { pretest_rank: 0 }, /pretest の pretest_rank/],
  ["pretest_time と pretest_rank の片方だけ null", { pretest_time: null }, /片方だけが null/],
  ["race_date が実在しない日", { race_date: "2026-09-31" }, /pretest の race_date/],
];

for (const [label, extra, message] of BROKEN) {
  await test(`${label}の行は RangeError で reject する`, async () => {
    // 実在しない日の破れは、その日を引く日にして期間の絞り（文字列の比べ）に掛ける
    use([pretest(4320, "2026-09-20"), pretest(3941, "2026-09-19", extra)]);
    const date = extra.race_date ? "2026-09-31" : DATE;
    await assert.rejects(fetchPretestByRacer(VENUE, date), (err) => {
      assert.ok(err instanceof RangeError, `RangeError でない: ${err}`);
      assert.match(err.message, message);
      assert.match(err.message, /venue_code=5/);
      return true;
    });
  });
}

await test("行が無いときは空の Map", async () => {
  use([]);
  const out = await fetchPretestByRacer(VENUE, DATE);
  assert.ok(out instanceof Map);
  assert.equal(out.size, 0);
});

await test("正の行は選手ごとの最新が凍結した行で返り、select は4列のまま", async () => {
  const fake = use([
    pretest(3941, "2026-09-19", { pretest_time: 6.8, pretest_rank: 5 }),
    pretest(3941, "2026-09-20"),
    pretest(4320, "2026-09-20", { pretest_time: null, pretest_rank: null }),
    pretest(4320, "2026-09-10"),
  ]);
  const out = await fetchPretestByRacer(VENUE, DATE);
  assert.deepEqual(fake.queriesOn("motor_pretest_stats").map((q) => q.select), [
    "racer_id, race_date, pretest_time, pretest_rank",
  ]);
  assert.deepEqual([...out.keys()].sort(), [3941, 4320]);
  for (const r of out.values()) assert.ok(Object.isFrozen(r), `行が凍結されていない: ${r.racer_id}`);
  assert.deepEqual({ ...out.get(3941) }, {
    venue_code: VENUE,
    racer_id: 3941,
    race_date: "2026-09-20",
    pretest_time: 6.75,
    pretest_rank: 2,
  });
  assert.equal(out.get(4320).pretest_rank, null);
});

console.log(`verify-motor-pretest-make: ${count} 件 OK`);
