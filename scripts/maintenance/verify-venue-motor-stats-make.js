#!/usr/bin/env node
/**
 * motorQueries3.js の getVenueMotorStats（会場公式のモーター成績の最新スナップショット）が venue_motor_stats の行を
 * makeMotorStat（src/pure/motorModel.js）に通すことの振る舞いの試験（DM1x motor のつなぎ）。偽の supabase
 * （verifyData/fakeServiceSupabase.js、select で頼んだ列だけ返す）の上でサービス層を直に呼ぶ。DB・ネットワーク・fs は使わない。
 *
 * 確かめること:
 *   - 正の行は今までどおり camelCase の値で返る（make を通しても値は変わらない）
 *   - 行が無いときは null（make を通さない）
 *   - 破れの行（会場コードが範囲の外・scraped_date が実在しない日・回数が整数でない）は makeMotorStat の RangeError を
 *     内の catch が受けて { fetchFailed: true } を返し（呼び手は取得失敗の表示）、失敗はキャッシュに残らない
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

const { getVenueMotorStats } = await import("../../src/services/motorQueries3.js");

const stat = (extra = {}) => ({
  venue_code: 4,
  motor_number: 21,
  scraped_date: "2026-11-10",
  source_template: "standard",
  meet_count: 5,
  race_count: 40,
  final_count: 3,
  championship_count: 1,
  first_place_count: 6,
  second_place_count: 7,
  third_place_count: 8,
  win_rate: 6.1,
  top2_rate: 41.2,
  top3_rate: null,
  accident_rate: 0.5,
  best_time: "1.46.2",
  avg_exhibition_time: 6.78,
  stats_period_start: "2026-05-01",
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
  ["会場コードが範囲の外", { venue_code: 25 }, /motor の会場コード/],
  ["scraped_date が実在しない日", { scraped_date: "2026-02-30" }, /motor の scraped_date/],
  ["race_count が整数でない", { race_count: 4.5 }, /motor の race_count/],
];

for (const [label, extra, message] of BROKEN) {
  await test(`${label}の行は fetchFailed を返す（RangeError を取得失敗と同じ道へ）`, async () => {
    // 取得日の絞りに掛かるよう、破れの行も同じ会場・機番で引ける値にする（会場コードの破れは引く会場をそれに合わせる）
    const row = stat(extra);
    use([row]);
    const { value, lines } = await quiet(() => getVenueMotorStats(row.venue_code, row.motor_number, "2026-11-10"));
    assert.deepEqual(value, { fetchFailed: true });
    assert.ok(lines.some((l) => message.test(l)), `破れの文が出ていない: ${lines.join(" / ")}`);
  });
}

await test("行が無いときは null", async () => {
  // null は保存される（行なし）ので、下の正の試験と別のキーで引く
  use([]);
  assert.equal(await getVenueMotorStats(4, 21, "2026-11-11"), null);
});

await test("正の行は camelCase の値のまま返る（直前の破れはキャッシュに残らない）", async () => {
  use([stat({ scraped_date: "2026-11-01", race_count: 30 }), stat()]);
  const out = await getVenueMotorStats(4, 21, "2026-11-10");
  assert.deepEqual(out, {
    scrapedDate: "2026-11-10",
    meetCount: 5,
    raceCount: 40,
    finalCount: 3,
    championshipCount: 1,
    firstPlaceCount: 6,
    secondPlaceCount: 7,
    thirdPlaceCount: 8,
    winRate: 6.1,
    top2Rate: 41.2,
    top3Rate: null,
    accidentRate: 0.5,
    bestTime: "1.46.2",
    avgExhibitionTime: 6.78,
    statsPeriodStart: "2026-05-01",
    statsPeriodEnd: "2026-11-09",
  });
});

console.log(`verify-venue-motor-stats-make: ${count} 件 OK`);
