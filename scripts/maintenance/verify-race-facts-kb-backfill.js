// facts の kb 層の取り込み（scripts/lib/raceFactsKbJob.js と CLI の引数）が、半月ずつ組み立て、グレードを 190 と同じ順で当て、消す行を正しく選び、消しすぎを止めることを守る（ADR-0113 決定3）
// - グレードは特別な節の補正 → kb_archive_venue_days.race_grade の順。補正の数の食い違いは throw
// - 窓の既存の facts の kb の行のうち、組み立て直した行に無い物だけを消す。2割を超えたら allowMassDelete が無い限り書かずに止める
// - レースの無い窓は飛ばす。全部で0レースなら throw。レースの無い艇は throw
// - 引数: --era=kb だけ、期間は kb の中（2019-04-01〜2025-12-02）、知らないオプションは throw
// 外部接続なし（読み書きは偽の関数）
import assert from "node:assert/strict";
import { buildWindowRows, runKbFacts, staleKeysOf } from "../lib/raceFactsKbJob.js";
import { parseArgs } from "./race-facts-backfill.js";

const race = (id, extra = {}) => ({
  race_id: id, race_date: id.slice(0, 10), venue_code: Number(id.slice(11, 13)), race_number: Number(id.slice(14, 16)),
  venue_day_id: id.slice(0, 13), stage: "予選", has_result: true, ...extra,
});
const boat = (raceId, n, racerId) => ({ race_id: raceId, boat_number: n, racer_id: racerId, finish_raw: "01" });
const WINDOWS = {
  "2025-11-01": {
    races: [race("2025-11-03-01-01"), race("2025-11-03-01-12", { stage: "優勝戦" })],
    boats: [boat("2025-11-03-01-01", 1, 4001), boat("2025-11-03-01-12", 1, 4002)],
    venueDays: [{ venue_day_id: "2025-11-03-01", race_grade: "G1", title: "x" }],
  },
  "2025-11-16": { races: [], boats: [], venueDays: [] },
};

// 純関数
assert.deepEqual(staleKeysOf(["a", "b", "c"], ["b"]), ["a", "c"]);
assert.deepEqual(staleKeysOf([], ["b"]), []);
const built = buildWindowRows(WINDOWS["2025-11-01"], new Map([["2025-11-03-01-12", "SG"]]));
assert.deepEqual(built.raceRows.map((r) => r.race_grade), ["G1", "SG"], "補正 → 開催日の格");
assert.deepEqual(built.raceRows.map((r) => r.is_final), [false, true]);
assert.equal(built.runRows.length, 2);
assert.deepEqual(built.raceRows[0].racer_ids, [4001, null, null, null, null, null], "そのレースの艇から racer_ids");
assert.deepEqual(built.raceRows[1].racer_ids, [4002, null, null, null, null, null]);
assert.equal(buildWindowRows({ ...WINDOWS["2025-11-01"], venueDays: [] }, new Map()).raceRows[0].race_grade, null);
assert.throws(
  () => buildWindowRows({ ...WINDOWS["2025-11-01"], boats: [boat("2025-11-03-01-05", 1, 1)] }, new Map()),
  /レースの無い艇/,
);

// 流れ（偽の読み書き）
const run = async ({ existing = { race: [], run: [] }, allowMassDelete = false, windows = WINDOWS, overrides } = {}) => {
  const writes = [];
  const logs = [];
  const totals = await runKbFacts({
    ranges: [{ from: "2025-11-01", to: "2025-11-16" }, { from: "2025-11-16", to: "2025-12-01" }],
    overrides: overrides ?? { raceIds: ["2025-11-03-01-12"], grades: ["SG"] },
    fetchWindow: async ({ from }) => windows[from],
    fetchExistingKeys: async () => existing,
    writeWindow: async (plan) => {
      writes.push(plan);
      return { written: plan.raceRows.length + plan.runRows.length };
    },
    allowMassDelete,
    log: (l) => logs.push(l),
  });
  return { totals, writes, logs };
};

const ok = await run({
  existing: {
    race: ["2025-11-03-01-01", "2025-11-03-01-12"],
    run: ["2025-11-03-01-01|1", "2025-11-03-01-12|1", "2025-11-03-01-12|2"],
  },
  allowMassDelete: true,
});
assert.equal(ok.writes.length, 1, "レースの無い窓は書かない");
assert.deepEqual(ok.writes[0].staleRun, ["2025-11-03-01-12|2"]);
assert.deepEqual(ok.writes[0].staleRace, []);
assert.equal(ok.writes[0].raceRows[1].race_grade, "SG");
assert.deepEqual(ok.totals, { races: 2, runs: 2, written: 4, staleRace: 0, staleRun: 1, windows: 1 });
assert.ok(ok.logs.some((l) => l.includes("飛ばす")));

// 既存5行のうち1行は2割ちょうど（止めない）、6行のうち2行は超える（止める）
const five = { race: ["2025-11-03-01-01", "2025-11-03-01-12"], run: ["2025-11-03-01-01|1", "2025-11-03-01-12|1", "2025-11-03-01-12|2"] };
assert.equal((await run({ existing: five })).writes.length, 1);
await assert.rejects(
  run({ existing: { race: [...five.race, "2025-11-03-01-02"], run: [...five.run] } }),
  /2割|20%/,
);
assert.equal((await run({ existing: { race: [...five.race, "2025-11-03-01-02"], run: five.run }, allowMassDelete: true })).writes.length, 1);
await assert.rejects(run({ windows: { "2025-11-01": WINDOWS["2025-11-16"], "2025-11-16": WINDOWS["2025-11-16"] } }), /0だった/);
await assert.rejects(run({ overrides: { raceIds: ["a"], grades: [] } }), /数が違う/);

// 引数
assert.deepEqual(parseArgs(["--era=kb"]), { era: "kb", apply: false, from: "2019-04-01", to: "2025-12-02", allowMassDelete: false });
assert.equal(parseArgs(["--era=kb", "--apply", "--from=2025-11-01", "--to=2025-11-30"]).apply, true);
assert.equal(parseArgs(["--era=kb", "--allow-mass-delete"]).allowMassDelete, true);
assert.throws(() => parseArgs([]), /--era=kb/);
assert.throws(() => parseArgs(["--era=main"]), /--era=kb/);
assert.throws(() => parseArgs(["--era=kb", "--to=2025-12-03"]), /期間/);
assert.throws(() => parseArgs(["--era=kb", "--from=2019-03-31"]), /期間/);
assert.throws(() => parseArgs(["--era=kb", "--from=2025-11-02", "--to=2025-11-01"]), /期間/);
assert.throws(() => parseArgs(["--era=kb", "--from=2025/11/01"]), /YYYY-MM-DD/);
assert.throws(() => parseArgs(["--era=kb", "--x"]), /知らない/);

console.log("verify-race-facts-kb-backfill: OK");
