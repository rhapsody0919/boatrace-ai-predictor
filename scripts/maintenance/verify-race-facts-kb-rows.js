// kb_archive の1レースから race_facts・run_facts の行を組み立てる純関数（scripts/lib/raceFactsKb.js）が、列をそろえ、規則どおりに値を決め、facts の表の CHECK を通ることを守る（ADR-0113）
// - 列は RACE_FACT_COLUMNS・RUN_FACT_COLUMNS とちょうど同じ（キーのそろわない行を作らない）
// - era は 'kb'、race_date は race_id の日付。kb の期間（〜2025-12-02）の外・race_id と列のずれ・別のレースの艇・艇番の外は throw
// - 優勝戦は isCareerFinalStage（190 と同じ。オオムラGP・関ヶ原決戦も優勝戦）、着は成績コード（01〜06 は着、F・L・欠は着なし、S0 等の失格は着欄も NULL）、条件の出所は K の値があるときだけ 'k_file'
// - kb に無い列（気温・水温・潮位・複勝・チルト・オリジナル展示・風の扇形）は NULL
// - 組み立てた行を db-draft.md §9 の SQL（verifyData/race-facts-draft-sql.js の写し）を流した PGlite に入れると CHECK を通り、get_racer_runs がその選手の行を返す
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  RACE_FACT_COLUMNS,
  RUN_FACT_COLUMNS,
  RACE_FACTS_RULE_VERSION,
  buildKbRaceFact,
  buildKbRunFacts,
} from "../lib/raceFactsKb.js";
import { RACE_FACTS_MIGRATION_SQL, RACE_FACTS_SAME_RACE_SQL } from "./verifyData/race-facts-migration-files.js";

const RACE = {
  race_id: "2025-12-02-12-12",
  race_date: "2025-12-02",
  venue_code: 12,
  race_number: 12,
  stage: "優勝戦",
  deadline_time: "16:30:00",
  weather: "晴",
  wind_speed: 3,
  wave_height: 2,
  technique: "逃げ",
  has_result: true,
  dead_heat: false,
  payout_win: 180,
  payout_3tan: 1520,
  combo_3tan: "1-2-3",
  payout_3fuku: 420,
};
const DAY = { title: "住之江の優勝戦", series_day: 6, is_final_day: true };
const CODES = ["01", "02", "F", "K0", "S0", "03"];
const BOATS = CODES.map((code, i) => ({
  race_id: RACE.race_id,
  boat_number: i + 1,
  racer_id: 4000 + i,
  class: "A1",
  motor_number: 10 + i,
  course: i === 3 ? null : i + 1,
  start_timing: i === 2 ? -0.02 : 0.12,
  is_flying: i === 2,
  is_late_start: false,
  finish_raw: code,
  exhibition_time: 6.71,
  weight: i === 5 ? null : 52,
}));

test("レースの行: 列・値・kb に無い列は NULL", () => {
  const row = buildKbRaceFact(RACE, DAY, { grade: "SG", seriesKind: null });
  assert.deepEqual(row.racer_ids, [null, null, null, null, null, null], "艇を渡さなければ全部 null");
  const withBoats = buildKbRaceFact(RACE, DAY, { grade: "SG", seriesKind: null, boats: BOATS });
  assert.deepEqual(withBoats.racer_ids, [4000, 4001, 4002, 4003, 4004, 4005]);
  assert.deepEqual(withBoats.finish_order, [1, 2, 6, null, null, null], "着の順（F・欠・失格は着なし）");
  const heat = buildKbRaceFact(RACE, DAY, { grade: null, seriesKind: null, boats: [{ ...BOATS[0], boat_number: 3, finish_raw: "01" }, BOATS[0], { ...BOATS[0], boat_number: 2, finish_raw: "02" }] });
  assert.deepEqual(heat.finish_order, [1, 3, 2, null, null, null], "同着は艇番の順に詰める");
  assert.equal(buildKbRaceFact(RACE, DAY, { grade: null, seriesKind: null, boats: [{ ...BOATS[2] }] }).finish_order, null, "着が無ければ null");
  assert.deepEqual(Object.keys(row), [...RACE_FACT_COLUMNS]);
  assert.equal(row.era, "kb");
  assert.equal(row.is_final, true);
  assert.equal(row.condition_source, "k_file");
  assert.equal(row.race_grade, "SG");
  assert.equal(row.race_title, "住之江の優勝戦");
  assert.equal(row.rule_version, RACE_FACTS_RULE_VERSION);
  for (const c of ["temperature", "water_temperature", "tide_cm", "tide_phase", "wind_sector", "payout_place_1", "payout_place_2", "race_status"]) {
    assert.equal(row[c], null, c);
  }
  const plain = buildKbRaceFact({ ...RACE, stage: "予選", weather: null, wind_speed: null, wave_height: null }, null, { grade: null, seriesKind: "lady" });
  assert.equal(plain.is_final, false);
  assert.equal(plain.condition_source, null, "K の条件が無ければ出所も NULL");
  assert.equal(plain.race_title, null);
  assert.equal(plain.series_kind, "lady");
  assert.equal(buildKbRaceFact({ ...RACE, stage: null }, DAY, { grade: null, seriesKind: null }).is_final, null);
  for (const stage of ["オオムラGP", "関ヶ原決戦"]) {
    assert.equal(buildKbRaceFact({ ...RACE, stage }, DAY, { grade: null, seriesKind: null }).is_final, true, stage);
  }
  assert.equal(buildKbRaceFact({ ...RACE, dead_heat: true }, DAY, { grade: null, seriesKind: null }).dead_heat, true);
  assert.equal(buildKbRaceFact({ ...RACE, has_result: false }, DAY, { grade: null, seriesKind: null }).has_result, false);
});

test("レースの行: 期間の外・race_id のずれは throw", () => {
  const meta = { grade: null, seriesKind: null };
  assert.throws(() => buildKbRaceFact({ ...RACE, race_id: "2025-12-03-12-12", race_date: "2025-12-03" }, DAY, meta), /期間/);
  assert.throws(() => buildKbRaceFact({ ...RACE, race_id: "2019-03-31-12-12", race_date: "2019-03-31" }, DAY, meta), /期間/);
  assert.throws(() => buildKbRaceFact({ ...RACE, venue_code: 11 }, DAY, meta), /食い違う/);
  assert.throws(() => buildKbRaceFact({ ...RACE, race_number: 11 }, DAY, meta), /食い違う/);
  assert.throws(() => buildKbRaceFact({ ...RACE, race_date: "2025-12-01" }, DAY, meta), /食い違う/);
  assert.throws(() => buildKbRaceFact({ ...RACE, race_id: "x" }, DAY, meta), /形/);
  assert.equal(buildKbRaceFact({ ...RACE, race_date: new Date("2025-12-02T00:00:00Z") }, DAY, meta).race_date, "2025-12-02");
});

test("艇の行: 列・着・進入・体重の出所", () => {
  const rows = buildKbRunFacts(RACE, BOATS);
  for (const r of rows) assert.deepEqual(Object.keys(r), [...RUN_FACT_COLUMNS]);
  assert.deepEqual(rows.map((r) => [r.finish_mark, r.finish_rank]), [
    ["1", 1], ["2", 2], ["F", null], ["欠", null], [null, null], ["3", 3],
  ]);
  assert.deepEqual(rows.map((r) => r.course), [1, 2, 3, null, 5, 6]);
  assert.deepEqual(rows.map((r) => r.weight_source), ["b_file", "b_file", "b_file", "b_file", "b_file", null]);
  assert.equal(rows[2].start_timing, -0.02);
  assert.equal(rows[0].finish_code, "01");
  assert.equal(rows[0].era, "kb");
  assert.equal(rows[0].race_date, "2025-12-02");
  for (const c of ["f_count", "tilt", "parts_changed", "oriten_lap", "oriten_turn", "oriten_straight"]) assert.equal(rows[0][c], null, c);
  assert.equal(buildKbRunFacts(RACE, [{ ...BOATS[0], course: 7 }])[0].course, null, "1〜6 の外の進入は NULL");
  assert.equal(buildKbRunFacts(RACE, [{ ...BOATS[0], finish_raw: null }])[0].finish_mark, null);
  assert.throws(() => buildKbRunFacts(RACE, [{ ...BOATS[0], race_id: "2025-12-02-12-11" }]), /別のレース/);
  assert.throws(() => buildKbRunFacts(RACE, [{ ...BOATS[0], boat_number: 7 }]), /艇番/);
  assert.throws(() => buildKbRunFacts(RACE, [{ ...BOATS[0], boat_number: 0 }]), /艇番/);
});

const db = new PGlite();
before(async () => {
  const sql = `${RACE_FACTS_MIGRATION_SQL}${RACE_FACTS_SAME_RACE_SQL}`;
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec(`BEGIN;${sql}COMMIT;`);
});

const insert = (table, columns, row) =>
  db.query(
    `INSERT INTO ${table}(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map((c) => row[c]),
  );

test("組み立てた行は facts の表の CHECK を通り、RPC で読める", async () => {
  const race = buildKbRaceFact(RACE, DAY, { grade: "SG", seriesKind: null, boats: BOATS });
  await insert("race_facts", RACE_FACT_COLUMNS, race);
  for (const r of buildKbRunFacts(RACE, BOATS)) await insert("run_facts", RUN_FACT_COLUMNS, r);
  await db.exec("SET ROLE anon");
  try {
    const got = (await db.query("SELECT get_racer_runs(4002, '2019-04-01') AS j")).rows[0].j;
    assert.equal(got.length, 1);
    assert.equal(got[0].finish_mark, "F");
    assert.equal(got[0].race.is_final, true);
    assert.equal(got[0].race.condition_source, "k_file");
  } finally {
    await db.exec("RESET ROLE");
  }
});
