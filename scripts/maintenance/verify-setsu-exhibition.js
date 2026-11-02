/** BOA-1221: 固定行・偽の fetchAll のみ。本番接続なし。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setsuExhibitionOf, readSetsuExhibition } from "../sns/setsu-exhibition.js";

const date = "2026-11-02";
const series = [{ venue_code: 1, start_date: "2026-10-30", end_date: "2026-11-02", title: "節A", grade: "G1" }];
const races = [
  { race_id: "202611020101", race_date: date, venue_code: 1, race_number: 1, cancellation_status: "tentative" },
  { race_id: "202610300101", race_date: "2026-10-30", venue_code: 1, race_number: 1 },
  { race_id: "202611020102", race_date: date, venue_code: 1, race_number: 2, cancellation_status: "confirmed" },
];
const conditions = races.map((r) => ({ race_id: r.race_id, series_day: r.race_date === date ? 4 : 1, is_final_day: r.race_date === date, race_stage: "予選" }));
const entries = races.flatMap((r) => Array.from({ length: 6 }, (_, i) => ({ race_id: r.race_id, boat_number: i + 1, racer_id: 4006 - i, player_name: `選手${i}`, motor_number: i + 10, is_absent: i === 4 })));
const exhibitions = entries.map((e) => ({ race_id: e.race_id, boat_number: e.boat_number, exhibition_time: [6.7, 6.71, "6.71", 6.72, 6.5, null][e.boat_number - 1], exhibition_course: 7 - e.boat_number }));
const motors = [{ race_date: "2026-10-30", venue_code: 1, racer_id: 4006, motor_number: 10, motor_2rate: 0 }, { race_date: date, venue_code: 1, racer_id: 4005, motor_number: 11, motor_2rate: 99 }];
const rows = { series, races, conditions, entries, exhibitions, motors };
const snapshot = JSON.stringify(rows);
const result = setsuExhibitionOf(date, rows);
const meet = result.meets[0];
assert.equal(result.date, date);
assert.deepEqual({ ...meet, racers: [] }, { meet_id: "1-2026-10-30", ...series[0], series_day: 4, is_final_day: true, racers: [] });
assert.deepEqual(meet.racers.map((r) => r.racer_id), [4001, 4002, 4003, 4004, 4005, 4006]);
assert.deepEqual(meet.racers.map((r) => r.runs[0].exhibition_rank), [null, null, 4, 2, 2, 1]);
assert.equal(meet.racers[5].motor_2rate_at_start, 0);
assert.equal(meet.racers[4].motor_2rate_at_start, null);
assert.deepEqual(meet.racers[5].runs, [
  { race_id: "202610300101", date: "2026-10-30", race_number: 1, race_stage: "予選", boat_number: 1, exhibition_time: 6.7, exhibition_rank: 1, exhibition_course: 6 },
  { race_id: "202611020101", date, race_number: 1, race_stage: "予選", boat_number: 1, exhibition_time: 6.7, exhibition_rank: 1, exhibition_course: 6 },
]);
assert.equal(JSON.stringify(rows), snapshot, "入力を変更しない");
assert.deepEqual(setsuExhibitionOf(date), { date, meets: [] });
const postponed = { ...series[0], end_date: "2026-10-30" };
assert.equal(setsuExhibitionOf(date, { ...rows, series: [postponed] }).meets.length, 1);
assert.equal(setsuExhibitionOf(date, { ...rows, series: [{ ...postponed, end_date: "2026-10-29" }] }).meets.length, 0);
assert.equal(setsuExhibitionOf(date, { ...rows, series: [{ ...postponed, start_date: "2026-11-03" }] }).meets.length, 0);
assert.equal(setsuExhibitionOf(date, { ...rows, races: races.filter((r) => r.race_date !== date) }).meets.length, 0);
const changed = structuredClone(rows);
changed.exhibitions[0].is_absent = true;
assert.equal(setsuExhibitionOf(date, changed).meets[0].racers[5].runs[1].exhibition_rank, null);
changed.conditions[0].series_day = 3;
assert.equal(setsuExhibitionOf(date, changed).meets[0].series_day, 3);
changed.conditions = [];
assert.equal(setsuExhibitionOf(date, changed).meets[0].series_day, null);

// 日ごとの秒数が逆転しても、そのレースの中だけで順位を付ける。
const daily = structuredClone(rows);
daily.exhibitions.find((e) => e.race_id === "202610300101" && e.boat_number === 1).exhibition_time = 7.5;
assert.deepEqual(setsuExhibitionOf(date, daily).meets[0].racers[5].runs.map((r) => r.exhibition_rank), [4, 1]);
const noExhibition = setsuExhibitionOf(date, { ...rows, exhibitions: [] });
assert.ok(noExhibition.meets[0].racers.every((r) => r.runs.every((run) => run.exhibition_rank === null && run.exhibition_time === null)));

const tables = { races, race_series: series, race_conditions: conditions, race_entries: entries, exhibition_data: exhibitions, motor_pretest_stats: motors };
const calls = [];
const fakeFetchAll = async (table, select, build) => {
  const filters = [];
  const orders = [];
  const q = {};
  for (const op of ["eq", "in", "gte", "lte"]) q[op] = (key, value) => { filters.push([op, key, value]); return q; };
  q.order = (key) => { orders.push(key); return q; };
  build(q);
  assert.ok(orders.length, `${table} のページ順序`);
  calls.push({ table, select, filters, orders });
  return tables[table].filter((row) => filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "in" ? value.includes(row[key]) : op === "gte" ? row[key] >= value : row[key] <= value));
};
assert.deepEqual(await readSetsuExhibition(date, fakeFetchAll), result);
const second = { ...series[0], start_date: "2026-11-01" };
tables.race_series = [...series, second];
const overlap = await readSetsuExhibition(date, fakeFetchAll);
assert.equal(overlap.meets[0].racers[5].runs.length, 2, "隣の節の許容期間と重なっても走を重複させない");
tables.race_series = series;

assert.deepEqual(calls.find((c) => c.table === "motor_pretest_stats").filters, [["eq", "venue_code", 1], ["eq", "race_date", "2026-10-30"]]);
assert.deepEqual(await readSetsuExhibition(date, async () => []), { date, meets: [] });
await assert.rejects(readSetsuExhibition(date, async () => { throw new Error("read failed"); }), /read failed/);
for (const invalid of ["2026/11/02", "2026-02-30", "bad"]) {
  const child = spawnSync(process.execPath, ["scripts/sns/setsu-exhibition.js", invalid], { encoding: "utf8" });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /使い方/);
}
console.log("OK: 節・順位（同タイム/0.01秒差/欠場/欠損）・中止・初日2連率・順序・取得範囲・CLI 日付");
