import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setsuExhibitionOf, readSetsuExhibition } from "../sns/setsu-exhibition.js";

const date = "2026-11-02";
const series = [{ venue_code: 1, start_date: "2026-10-30", end_date: "2026-10-30", title: "試験節", grade: null }];
const race = (race_id, race_date, cancellation_status = null, venue_code = 1) =>
  ({ race_id, race_date, venue_code, race_number: 1, cancellation_status });
const races = [race("r2", date, "tentative"), race("r1", "2026-10-30"),
  race("r3", date, "confirmed"), race("old", "2026-10-29"), race("future", "2026-11-03")];
const conditions = [{ race_id: "r2", series_day: 2, is_final_day: true, race_stage: "優勝戦" },
  { race_id: "r3", series_day: 3, is_final_day: true }];
const entries = races.flatMap((r) => Array.from({ length: 6 }, (_, i) => ({
  race_id: r.race_id, boat_number: i + 1, racer_id: 4006 - i,
  player_name: `選手${i + 1}`, motor_number: 10 + i, is_absent: i === 4,
})));
const exhibitions = entries.filter((e) => !(e.race_id === "r2" && e.boat_number === 6)).map((e) => ({
  race_id: e.race_id, boat_number: e.boat_number, exhibition_course: 7 - e.boat_number,
  exhibition_time: e.race_id === "r1" ? [6.8, 6.81, "6.81", 6.82, 6.7, null][e.boat_number - 1]
    : [6.9, 6.91, 6.92, 6.7, 6.6, null][e.boat_number - 1],
  is_absent: e.race_id === "r2" && e.boat_number === 4,
}));
const pretests = [
  { race_date: "2026-10-30", venue_code: 1, racer_id: 4006, motor_number: 10, motor_2rate: 0 },
  { race_date: date, venue_code: 1, racer_id: 4005, motor_2rate: 99 },
  { race_date: "2026-10-30", venue_code: 2, racer_id: 4005, motor_2rate: 88 },
];
const rows = { series, races, conditions, entries, exhibitions, pretests };
const snapshot = JSON.stringify(rows);
const result = setsuExhibitionOf(date, rows);
assert.equal(JSON.stringify(rows), snapshot, "入力を変更しない");
assert.deepEqual(result.meets.map((m) => ({ ...m, racers: [] })), [{
  meet_id: "1-2026-10-30", venue_code: 1, start_date: "2026-10-30", end_date: "2026-10-30",
  title: "試験節", grade: null, series_day: 2, is_final_day: true, racers: [],
}]);
const racers = result.meets[0].racers;
assert.deepEqual(racers.map((r) => r.racer_id), [4001, 4002, 4003, 4004, 4005, 4006]);
assert.deepEqual(racers.map((r) => r.runs.map((x) => x.race_id)), Array(6).fill(["r1", "r2"]));
const byBoat = [...racers].reverse();
assert.deepEqual(byBoat.map((r) => r.runs[0].exhibition_rank), [1, 2, 2, 4, null, null]);
assert.deepEqual(byBoat.map((r) => r.runs[1].exhibition_rank), [1, 2, 3, null, null, null]);
assert.deepEqual(byBoat[0], { racer_id: 4006, name: "選手1", motor_number: 10, motor_2rate_at_start: 0, runs: [
  { race_id: "r1", date: "2026-10-30", race_number: 1, race_stage: null, boat_number: 1,
    exhibition_time: 6.8, exhibition_rank: 1, exhibition_course: 6 },
  { race_id: "r2", date, race_number: 1, race_stage: "優勝戦", boat_number: 1,
    exhibition_time: 6.9, exhibition_rank: 1, exhibition_course: 6 },
] });
assert.equal(byBoat[1].motor_2rate_at_start, null, "初日以外・他会場の率を使わない");
assert.equal(byBoat[5].runs[1].exhibition_time, null);
assert.equal(byBoat[5].runs[1].exhibition_course, null);
assert.throws(() => setsuExhibitionOf(date, { ...rows,
  entries: [{ ...entries[0], racer_id: null }] }), /racer_id/);
assert.deepEqual(setsuExhibitionOf(date), { date, meets: [] });
assert.equal(setsuExhibitionOf("2026-11-03", { ...rows, races: [race("r2", "2026-11-03")] }).meets.length, 0);
assert.equal(setsuExhibitionOf("2026-10-29", rows).meets.length, 0, "初日より前");
const second = { venue_code: 2, start_date: date, end_date: date, title: "別節", grade: "G1" };
const multi = setsuExhibitionOf(date, { ...rows, series: [second, ...series], races: [...races, race("v2", date, null, 2)] });
assert.deepEqual(multi.meets.map((m) => m.venue_code), [1, 2]);
assert.equal(multi.meets[1].series_day, null);
assert.equal(multi.meets[1].is_final_day, false);
assert.equal(setsuExhibitionOf(date, { ...rows, series: [...series, { ...series[0], start_date: date, end_date: date }] }).meets[0].start_date, date);
assert.deepEqual(setsuExhibitionOf(date, Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [...v].reverse()]))), result);

// 読み取りのクエリを固定の行へ適用。実クライアント・鍵・外部接続を使わない。
const tables = { race_series: series, races, race_conditions: conditions, race_entries: entries,
  exhibition_data: exhibitions, motor_pretest_stats: pretests };
const fakeFetchAll = async (table, columns, build) => {
  let data = tables[table];
  const order = [];
  const q = {
    eq(k, v) { data = data.filter((r) => r[k] === v); return q; },
    in(k, v) { assert.ok(v.length <= 100); data = data.filter((r) => v.includes(r[k])); return q; },
    gte(k, v) { data = data.filter((r) => r[k] >= v); return q; },
    lte(k, v) { data = data.filter((r) => r[k] <= v); return q; },
    order(k) { order.push(k); return q; },
  };
  build(q);
  assert.ok(order.length, `${table}: ページングの並び順`);
  return data.map((r) => Object.fromEntries(columns.split(",").map((k) => [k, r[k]])));
};
assert.deepEqual(await readSetsuExhibition(date, fakeFetchAll), result);
assert.deepEqual(await readSetsuExhibition("2026-12-01", fakeFetchAll), { date: "2026-12-01", meets: [] });
await assert.rejects(readSetsuExhibition(date, async () => { throw new Error("取得失敗"); }), /取得失敗/);
await assert.rejects(readSetsuExhibition(date, async (table, ...args) => {
  if (table === "exhibition_data") throw new Error("展示取得失敗");
  return fakeFetchAll(table, ...args);
}), /展示取得失敗/, "途中の失敗をデータなしに変えない");
// 100レースの取得境界をまたぐ1,206行。全艇の全走が欠けない。
const manyRaces = Array.from({ length: 201 }, (_, i) => race(`m${String(i).padStart(3, "0")}`, date));
tables.races = manyRaces;
tables.race_entries = manyRaces.flatMap((r) => entries.slice(0, 6).map((e) => ({ ...e, race_id: r.race_id })));
tables.exhibition_data = tables.race_entries.map((e) => ({ race_id: e.race_id,
  boat_number: e.boat_number, exhibition_time: 6.8, exhibition_course: e.boat_number }));
const many = await readSetsuExhibition(date, fakeFetchAll);
assert.deepEqual(many.meets[0].racers.map((r) => r.runs.length), Array(6).fill(201));
for (const invalid of [undefined, "2026/11/02", "2026-02-30", "2026-13-01"]) {
  assert.throws(() => setsuExhibitionOf(invalid));
  const cli = spawnSync(process.execPath, ["scripts/sns/setsu-exhibition.js", ...(invalid ? [invalid] : [])], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.equal(cli.stdout, "");
}
console.log("OK: 節の展示順位・欠場・中止・順延・初日の率・読み取り・日付エラー");
