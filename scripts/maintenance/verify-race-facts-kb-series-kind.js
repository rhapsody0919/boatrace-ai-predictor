// kb 層の facts の書き手（raceFactsKbJob.js の buildWindowRows）が、race_series の節から main と同じ当て方（seriesFinder、始まりの遅い方）で series_kind を入れ、節が無ければ NULL にすることを守る（data-gaps plan.md §3.1）
// - 節は同じ会場で開始日〜終了日に日付を含む物。2節に当たれば始まりの遅い方、当たらなければ NULL
// - 窓に series を渡さない（今までの呼び手）なら全部 NULL のまま。グレードは今までどおり venue_days（節の種別で変えない）
// - seriesFinder は raceFactsKb.js の1つを kb と main の Cron が共有する（main 側の当て方は verify-race-facts-main-job.js が見る）
// 外部接続なし
import assert from "node:assert/strict";
import { buildWindowRows, runKbFacts } from "../lib/raceFactsKbJob.js";
import { seriesFinder } from "../lib/raceFactsKb.js";

const race = (id) => ({
  race_id: id, race_date: id.slice(0, 10), venue_code: Number(id.slice(11, 13)), race_number: Number(id.slice(14, 16)),
  venue_day_id: id.slice(0, 13), stage: "予選", has_result: true,
});
const IDS = ["2025-11-03-01-01", "2025-11-05-01-01", "2025-11-03-02-01", "2025-11-09-01-01"];
const WINDOW = {
  races: IDS.map(race),
  boats: IDS.map((id) => ({ race_id: id, boat_number: 1, racer_id: 4001, finish_raw: "01" })),
  venueDays: IDS.map((id) => ({ venue_day_id: id.slice(0, 13), race_grade: "ippan", title: "t" })),
  series: [
    { venue_code: 1, start_date: "2025-11-01", end_date: "2025-11-06", kind: "ippan" },
    { venue_code: 1, start_date: "2025-11-05", end_date: "2025-11-08", kind: "lady" },
    { venue_code: 2, start_date: "2025-11-02", end_date: "2025-11-07", kind: "rookie" },
  ],
};

const kindOf = (rows) => Object.fromEntries(rows.raceRows.map((r) => [r.race_id, r.series_kind]));
assert.deepEqual(kindOf(buildWindowRows(WINDOW, new Map())), {
  "2025-11-03-01-01": "ippan",
  "2025-11-05-01-01": "lady",
  "2025-11-03-02-01": "rookie",
  "2025-11-09-01-01": null,
}, "節の種別、2節なら遅い方、当たらなければ NULL");

const { series, ...withoutSeries } = WINDOW;
assert.ok(series.length > 0);
assert.ok(Object.values(kindOf(buildWindowRows(withoutSeries, new Map()))).every((k) => k === null), "series を渡さなければ NULL");

const graded = buildWindowRows(WINDOW, new Map([["2025-11-05-01-01", "G2"]]));
assert.deepEqual(graded.raceRows.map((r) => r.race_grade), ["ippan", "G2", "ippan", "ippan"], "グレードは補正 → venue_days のまま");

// race_date が Date でも同じ
const find = seriesFinder(WINDOW.series);
assert.equal(find({ venue_code: 1, race_date: new Date("2025-11-05T00:00:00Z") }).kind, "lady");
assert.equal(find({ venue_code: 1, race_date: "2025-11-08" }).kind, "lady", "終了日を含む");
assert.equal(find({ venue_code: 1, race_date: "2025-10-31" }), null);


// CLI の流れ（runKbFacts）でも、fetchWindow が返す series が書く行の種別に届く。空の窓は飛ばし、合計・消す行・2割の線は今までどおり
const written = [];
const deps = (existing) => ({
  ranges: [{ from: "2025-10-16", to: "2025-11-01" }, { from: "2025-11-01", to: "2025-11-16" }],
  overrides: { raceIds: ["2025-11-05-01-01"], grades: ["G2"] },
  fetchWindow: async (r) => (r.from === "2025-11-01" ? WINDOW : { races: [], boats: [], venueDays: [], series: [] }),
  fetchExistingKeys: async () => existing,
  writeWindow: async (plan) => { written.push(plan); return { written: plan.raceRows.length + plan.runRows.length }; },
  log: () => {},
});
const totals = await runKbFacts(deps({ race: [...IDS, "2025-11-10-01-01"], run: ["2025-11-03-01-01|1"] })); // 消えるのは 1/6
assert.deepEqual(totals, { races: 4, runs: 4, written: 8, staleRace: 1, staleRun: 0, windows: 1 });
assert.equal(written.length, 1, "空の窓は書かない");
assert.deepEqual(kindOf(written[0]), { "2025-11-03-01-01": "ippan", "2025-11-05-01-01": "lady", "2025-11-03-02-01": "rookie", "2025-11-09-01-01": null });
assert.equal(written[0].raceRows[1].race_grade, "G2", "補正のグレード");
assert.deepEqual(written[0].staleRace, ["2025-11-10-01-01"]);
const many = { race: ["2025-11-03-01-01", "2025-11-11-01-01", "2025-11-12-01-01", "2025-11-13-01-01"], run: [] };
await assert.rejects(runKbFacts(deps(many)), /消える行/, "2割を超えて消えるなら書かない");
assert.equal((await runKbFacts({ ...deps(many), allowMassDelete: true })).staleRace, 3);
await assert.rejects(runKbFacts({ ...deps({ race: [], run: [] }), overrides: { raceIds: ["x"], grades: [] } }), /数が違う/);
await assert.rejects(runKbFacts({ ...deps({ race: [], run: [] }), fetchWindow: async () => ({ races: [], boats: [], venueDays: [] }) }), /0だった/);

console.log("✅ verify-race-facts-kb-series-kind: kb の series_kind を節から main と同じ当て方で入れる");
