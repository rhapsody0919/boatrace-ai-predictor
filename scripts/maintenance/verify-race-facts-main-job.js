// facts の main 層を組み立て直す Cron（scripts/lib/raceFactsMainJob.js）が、窓の選び方（毎回 前日と当日、JST 01〜05時は古い半月を順に）・節の当て方・消す行の選び方・消しすぎの止め方を守る（ADR-0113 決定3）
// - 窓: 前日〜当日（[前日, 翌日)）。本体の最初の日より前は最初の日から。夜は cursor の半月を足し、次の cursor へ進み、末で最初に戻る
// - 節: 同じ会場で日付を含む節のうち始まりの遅い方。グレードの補正は窓ごとに当てる
// - 消す行: 窓の既存の facts の main の行のうち組み立て直した行に無い物。2割を超えたら allowMassDelete が無い限り止める
// 外部接続なし（読み書きは偽の関数）
import assert from "node:assert/strict";
import { buildMainWindowRows, runRaceFactsMainJob, seriesFinder, staleKeysOf, windowsFor } from "../lib/raceFactsMainJob.js";

// 窓
const day = windowsFor({ today: "2026-11-27", hourJst: 12, cursor: "2026-01-16" });
assert.deepEqual(day.windows, [{ from: "2026-11-26", to: "2026-11-28" }]);
assert.equal(day.nextCursor, "2026-01-16", "昼は cursor を動かさない");
const night = windowsFor({ today: "2026-11-27", hourJst: 1, cursor: "2026-01-16" });
assert.deepEqual(night.windows[1], { from: "2026-01-16", to: "2026-02-01" });
assert.equal(night.nextCursor, "2026-02-01");
assert.equal(windowsFor({ today: "2026-11-27", hourJst: 4, cursor: null }).windows[1].from, "2025-12-03", "cursor が無ければ最初から");
assert.equal(windowsFor({ today: "2026-11-27", hourJst: 5, cursor: null }).windows.length, 1, "05時は夜に入れない");
assert.equal(windowsFor({ today: "2026-11-27", hourJst: 0, cursor: null }).windows.length, 1);
const last = windowsFor({ today: "2026-11-27", hourJst: 2, cursor: "2026-11-16" });
assert.deepEqual(last.windows[1], { from: "2026-11-16", to: "2026-11-26" }, "前日の前まで");
assert.equal(last.nextCursor, "2025-12-03", "末まで行ったら最初に戻る");
assert.deepEqual(windowsFor({ today: "2025-12-03", hourJst: 2, cursor: null }).windows, [{ from: "2025-12-03", to: "2025-12-04" }]);
assert.equal(windowsFor({ today: "2025-12-04", hourJst: 2, cursor: null }).windows.length, 1, "前日が最初の日なら古い半月は無い");

// 節・消す行
const find = seriesFinder([
  { venue_code: 12, start_date: "2026-11-18", end_date: "2026-11-23", grade: "G1" },
  { venue_code: 12, start_date: "2026-11-20", end_date: "2026-11-25", grade: "SG" },
  { venue_code: 11, start_date: "2026-11-20", end_date: "2026-11-25", grade: "G3" },
]);
assert.equal(find({ venue_code: 12, race_date: "2026-11-21" }).grade, "SG", "始まりの遅い方");
assert.equal(find({ venue_code: 12, race_date: "2026-11-19" }).grade, "G1");
assert.equal(find({ venue_code: 12, race_date: "2026-11-26" }), null);
assert.deepEqual(staleKeysOf(["a", "b"], ["b"]), ["a"]);

const RACE = { race_id: "2026-11-26-12-01", race_date: "2026-11-26", venue_code: 12, race_number: 1, start_time: "10:00:00", race_grade: null };
const WINDOW = {
  races: [RACE],
  entries: [1, 2].map((b) => ({ race_id: RACE.race_id, boat_number: b, racer_id: 4000 + b })),
  results: [{ race_id: RACE.race_id, rank1: 2, rank2: 1, rank3: 3 }],
  timings: [{ race_id: RACE.race_id, boat_number: 2, finish_mark: "1" }],
  exhibitions: [],
  conditions: [],
  seriesOf: () => ({ grade: null, class_code: "Venus" }),
};
const rows = buildMainWindowRows(WINDOW, new Map());
assert.equal(rows.raceRows[0].race_grade, "ippan");
assert.equal(rows.runRows.length, 2);
assert.equal(rows.runRows[1].finish_rank, 1);
assert.deepEqual(rows.raceRows[0].racer_ids, [4001, 4002, null, null, null, null], "そのレースの出走表から racer_ids");
assert.deepEqual(rows.raceRows[0].finish_order, [2, 1, 3, null, null, null]);
assert.equal(buildMainWindowRows(WINDOW, new Map([[RACE.race_id, "G2"]])).raceRows[0].race_grade, "G2", "補正が先");

// 流れ（偽の読み書き）
const run = async ({ existing, allowMassDelete = false, hourJst = 12 }) => {
  const writes = [];
  const res = await runRaceFactsMainJob({
    today: "2026-11-27",
    hourJst,
    cursor: null,
    loadOverrides: async () => ({ raceIds: [], grades: [] }),
    fetchWindow: async () => WINDOW,
    fetchExistingKeys: async () => existing,
    writeWindow: async (plan) => {
      writes.push(plan);
      return { written: 3 };
    },
    allowMassDelete,
    log: () => {},
  });
  return { res, writes };
};
const ok = await run({ existing: { race: [RACE.race_id], run: [`${RACE.race_id}|1`, `${RACE.race_id}|2`, `${RACE.race_id}|3`, `${RACE.race_id}|4`] }, allowMassDelete: true });
assert.deepEqual(ok.writes[0].staleRun, [`${RACE.race_id}|3`, `${RACE.race_id}|4`]);
assert.deepEqual(ok.writes[0].staleRace, []);
assert.deepEqual(ok.res.totals, { races: 1, runs: 2, written: 3, stale: 2 });
assert.equal(ok.res.nextCursor, null);
await assert.rejects(run({ existing: { race: [RACE.race_id, "2026-11-26-12-02"], run: [`${RACE.race_id}|1`, `${RACE.race_id}|3`] } }), /20%/);
assert.equal((await run({ existing: { race: [RACE.race_id], run: [`${RACE.race_id}|1`, `${RACE.race_id}|2`] } })).writes[0].staleRun.length, 0, "消す行が無ければ止めない");
assert.equal((await run({ existing: { race: ["2026-11-26-12-02"], run: [] }, allowMassDelete: true })).writes.length, 1);
assert.equal((await run({ existing: { race: [], run: [] }, hourJst: 2 })).writes.length, 2, "夜は2つの窓");

console.log("verify-race-facts-main-job: OK");
