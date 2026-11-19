#!/usr/bin/env node
/**
 * motorQueries3.js の getVenueMotorSnapshot（会場の全モーターの公式成績の1スナップショット、motorQueries4 の一覧・順位の材料）が
 * venue_motor_stats の行を makeMotorStat（src/pure/motorModel.js）に通すことの振る舞いの試験（DM1x motor のつなぎ、A 群）。
 * 偽の supabase（verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 行の select は今までの9列のまま（録画の URL を変えない）。venue_code・scraped_date は eq の値を行に付ける
 *   - 正の行は値を変えずに凍結した行で返る（venue_code・scraped_date が足されるだけ）。行が無いときは empty
 *   - 破れ（機番が整数でない・race_count が整数でない・stats_period_end が実在しない日）は makeMotorStat の RangeError を
 *     内の catch が受けて { state: "error", fetchFailed: true } を返し（呼び手は取得失敗の表示）、失敗はキャッシュに残らない
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

const { getVenueMotorSnapshot } = await import("../../src/services/motorQueries3.js");

const SELECT =
  "motor_number, win_rate, top2_rate, top3_rate, accident_rate, final_count, championship_count, race_count, stats_period_end";
const VENUE = 4;
const stat = (motor, extra = {}) => ({
  venue_code: VENUE,
  motor_number: motor,
  scraped_date: "2026-11-10",
  source_template: "standard",
  win_rate: 6.1,
  top2_rate: 41.2,
  top3_rate: null,
  accident_rate: 0.5,
  final_count: 3,
  championship_count: 1,
  race_count: 40,
  stats_period_end: "2026-11-09",
  ...extra,
});

function use(rows) {
  return setFakeSupabase(createFakeSupabase({ venue_motor_stats: rows }, { project: true }));
}

// 失敗の道は console.error に1行を出す。試験の出力を汚さないよう黙らせ、出た文を見る
async function quiet(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = original;
  }
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok - ${name}`);
}

const BROKEN = [
  ["機番が整数でない", { motor_number: 21.5 }, /motor の motor_number/],
  ["race_count が整数でない", { race_count: 4.5 }, /motor の race_count/],
  ["stats_period_end が実在しない日", { stats_period_end: "2026-02-30" }, /motor の stats_period_end/],
];

for (const [label, extra, message] of BROKEN) {
  await test(`${label}の行は error・fetchFailed を返す（RangeError を取得失敗と同じ道へ）`, async () => {
    use([stat(11), stat(21, extra)]);
    const { value, lines } = await quiet(() => getVenueMotorSnapshot(VENUE, "2026-11-10"));
    assert.deepEqual(value, { state: "error", fetchFailed: true });
    assert.ok(lines.some((l) => message.test(l)), `破れの文が出ていない: ${lines.join(" / ")}`);
  });
}

await test("その日以前に行が無いときは empty", async () => {
  use([stat(11, { scraped_date: "2026-11-12" })]);
  assert.deepEqual(await getVenueMotorSnapshot(VENUE, "2026-11-11"), { state: "empty" });
});

await test("正の行は最新の取得日の行が凍結して値のまま返り、select は9列のまま（直前の破れはキャッシュに残らない）", async () => {
  const fake = use([stat(11, { scraped_date: "2026-11-01", race_count: 30 }), stat(11), stat(21)]);
  const out = await getVenueMotorSnapshot(VENUE, "2026-11-10");
  assert.equal(out.state, "ok");
  assert.equal(out.scrapedDate, "2026-11-10");
  assert.deepEqual(fake.queriesOn("venue_motor_stats").map((q) => q.select), ["scraped_date", SELECT]);
  assert.deepEqual(out.rows.map((r) => r.motor_number).sort(), [11, 21]);
  for (const r of out.rows) assert.ok(Object.isFrozen(r), `行が凍結されていない: 機番 ${r.motor_number}`);
  const { source_template: _skip, ...expected } = stat(11);
  assert.deepEqual({ ...out.rows.find((r) => r.motor_number === 11) }, expected);
});

console.log(`verify-venue-motor-snapshot-make: ${count} 件 OK`);
