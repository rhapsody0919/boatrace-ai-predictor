// 本体の表の1レースから race_facts・run_facts の行を組み立てる純関数（scripts/lib/raceFactsMain.js）が、kb と同じ列をそろえ、190 と同じ順でグレード・優勝戦・進入を決め、条件の出所を行ごとに分け、マイグレーション 212 の CHECK を通ることを守る（ADR-0113）
// - グレード: 補正 → races.race_grade → race_series.grade → class_code（Lady・Takumi は G3、Rookie・Venus は ippan）
// - 条件の出所: weather_observed_at が発走の時刻以後なら 'race_result'、前か NULL なら 'before_race'、値が無ければ NULL
// - 3連単は payout_trio、3連複は payout_trifecta。進入は entry_course → actual_course_N。着は finish_mark → 成績コード
// - 期間の外（〜2025-12-02）・race_id のずれ・別のレースの艇・艇番の外は throw
// 外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { RACE_FACT_COLUMNS, RUN_FACT_COLUMNS } from "../lib/raceFactsKb.js";
import { buildMainRaceFact, buildMainRunFacts, conditionSourceOf, mainGradeOf } from "../lib/raceFactsMain.js";
import { RACE_FACTS_MIGRATION_SQL, RACE_FACTS_SAME_RACE_SQL } from "./verifyData/race-facts-migration-files.js";

const RACE = { race_id: "2026-11-20-12-12", race_date: "2026-11-20", venue_code: 12, race_number: 12, start_time: "16:30:00", race_grade: null };
const SERIES = { grade: null, class_code: "Lady", kind: "lady", title: "節の題" };
const COND = { weather: "晴", wind_speed: 2.5, wave_height: 3, temperature: 14.5, water_temperature: 16, race_title: "題", series_day: 6, is_final_day: true, race_stage: "優勝戦", weather_observed_at: "2026-11-20T07:30:00Z" };
const RESULT = { rank1: 1, rank2: 3, rank3: 2, payout_win: 150, payout_place_1: 110, payout_place_2: 200, payout_trio: 980, payout_trifecta: 300, winning_technique: "逃げ", race_status: "normal", actual_course_2: 3 };

test("レースの行: 列・グレード・出所・払戻", () => {
  const row = buildMainRaceFact({ race: RACE, result: RESULT, conditions: COND, series: SERIES });
  assert.deepEqual(row.finish_order, [1, 3, 2, null, null, null], "race_results.rank1〜6 のまま");
  assert.deepEqual(row.racer_ids, [null, null, null, null, null, null]);
  assert.deepEqual(
    buildMainRaceFact({ race: RACE, entries: [{ boat_number: 2, racer_id: 9 }, { boat_number: 7, racer_id: 8 }] }).racer_ids,
    [null, 9, null, null, null, null],
    "艇番の順、1〜6 の外は入れない",
  );
  assert.deepEqual(Object.keys(row), [...RACE_FACT_COLUMNS]);
  assert.equal(row.era, "main");
  assert.equal(row.race_grade, "G3", "class_code Lady → G3");
  assert.equal(row.series_kind, "lady");
  assert.equal(row.is_final, true);
  assert.equal(row.condition_source, "race_result");
  assert.equal(row.payout_3tan, 980);
  assert.equal(row.payout_3fuku, 300);
  assert.equal(row.combo_3tan, "1-3-2");
  assert.equal(row.has_result, true);
  assert.equal(row.race_title, "題");
  for (const c of ["tide_cm", "tide_phase", "wind_sector"]) assert.equal(row[c], null, c);
  const bare = buildMainRaceFact({ race: RACE });
  assert.equal(bare.has_result, false);
  assert.equal(bare.condition_source, null);
  assert.equal(bare.combo_3tan, null);
  assert.equal(bare.is_final, null);
  assert.equal(buildMainRaceFact({ race: RACE, result: { ...RESULT, rank3: null } }).combo_3tan, null);
  assert.equal(buildMainRaceFact({ race: RACE, conditions: { ...COND, race_stage: "オオムラGP" } }).is_final, true);
  assert.equal(buildMainRaceFact({ race: RACE, conditions: { race_title: null }, series: SERIES }).race_title, "節の題");
});

test("グレードと出所の規則", () => {
  assert.equal(mainGradeOf({ race_grade: "SG" }, SERIES, "G1"), "G1", "補正が先");
  assert.equal(mainGradeOf({ race_grade: "SG" }, SERIES), "SG");
  assert.equal(mainGradeOf({ race_grade: null }, { grade: "G2", class_code: "Lady" }), "G2");
  assert.equal(mainGradeOf({ race_grade: null }, { class_code: "Takumi" }), "G3");
  assert.equal(mainGradeOf({ race_grade: null }, { class_code: "Rookie" }), "ippan");
  assert.equal(mainGradeOf({ race_grade: null }, { class_code: "Venus" }), "ippan");
  assert.equal(mainGradeOf({ race_grade: null }, null), null);
  const d = "2026-11-20";
  assert.equal(conditionSourceOf({ ...COND, weather_observed_at: "2026-11-20T07:29:59Z" }, RACE, d), "before_race");
  assert.equal(conditionSourceOf({ ...COND, weather_observed_at: "2026-11-20T07:30:00Z" }, RACE, d), "race_result", "発走の時刻ちょうどは結果ページ");
  assert.equal(conditionSourceOf({ ...COND, weather_observed_at: null }, RACE, d), "before_race");
  assert.equal(conditionSourceOf(COND, { ...RACE, start_time: null }, d), "before_race");
  assert.equal(conditionSourceOf({ weather: null, wind_speed: null, wave_height: null }, RACE, d), null);
  assert.equal(conditionSourceOf({ wave_height: 0, weather_observed_at: "2026-11-20T08:00:00Z" }, RACE, d), "race_result");
  assert.equal(conditionSourceOf(null, RACE, d), null);
});

test("期間の外・ずれは throw", () => {
  assert.throws(() => buildMainRaceFact({ race: { ...RACE, race_id: "2025-12-02-12-12", race_date: "2025-12-02" } }), /期間/);
  assert.throws(() => buildMainRaceFact({ race: { ...RACE, venue_code: 11 } }), /食い違う/);
  assert.throws(() => buildMainRaceFact({ race: { ...RACE, race_number: 1 } }), /食い違う/);
  assert.throws(() => buildMainRaceFact({ race: { ...RACE, race_id: "x" } }), /形/);
  assert.throws(() => buildMainRunFacts(RACE, [{ race_id: "2026-11-20-12-11", boat_number: 1 }]), /別のレース/);
  assert.throws(() => buildMainRunFacts(RACE, [{ race_id: RACE.race_id, boat_number: 7 }]), /艇番/);
});

const ENTRIES = [1, 2, 3].map((b) => ({ race_id: RACE.race_id, boat_number: b, racer_id: 4000 + b, grade: "A1", f_count: b === 3 ? 1 : 0, motor_number: 20 + b }));
const TIMINGS = [
  { boat_number: 1, entry_course: 1, start_timing: 0.11, is_flying: false, is_late_start: false, finish_mark: "1", finish_rank: 1, official_finish_code: "01" },
  { boat_number: 3, start_timing: -0.01, is_flying: true, is_late_start: false, finish_mark: null, official_finish_code: "F" },
];
const EXHIBITIONS = [{ boat_number: 1, exhibition_time: 6.72, today_weight: 52.0, tilt: -0.5, parts_changed: ["ピストン"] }];

test("艇の行: 列・進入・着・展示", () => {
  const rows = buildMainRunFacts(RACE, ENTRIES, { result: RESULT, timings: TIMINGS, exhibitions: EXHIBITIONS });
  for (const r of rows) assert.deepEqual(Object.keys(r), [...RUN_FACT_COLUMNS]);
  assert.deepEqual(rows.map((r) => r.course), [1, 3, null], "entry_course → actual_course_N");
  assert.deepEqual(rows.map((r) => [r.finish_mark, r.finish_rank]), [["1", 1], [null, null], ["F", null]]);
  assert.equal(rows[0].weight, 52);
  assert.equal(rows[0].weight_source, "beforeinfo");
  assert.equal(rows[1].weight_source, null);
  assert.deepEqual(rows[0].parts_changed, ["ピストン"]);
  assert.equal(rows[2].f_count, 1);
  assert.equal(rows[2].is_flying, true);
  assert.equal(buildMainRunFacts(RACE, [ENTRIES[0]], { timings: [{ boat_number: 1, finish_mark: "4" }] })[0].finish_rank, 4);
  assert.equal(buildMainRunFacts(RACE, [ENTRIES[0]], { timings: [{ boat_number: 1, entry_course: 9 }] })[0].course, null);
});

test("組み立てた行は 212・213 の CHECK を通り、RPC で読める", async () => {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec(`BEGIN;${RACE_FACTS_MIGRATION_SQL}COMMIT;`);
  await db.exec(`BEGIN;${RACE_FACTS_SAME_RACE_SQL}COMMIT;`);
  const insert = (table, columns, row) =>
    db.query(`INSERT INTO ${table}(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => row[c]));
  await insert("race_facts", RACE_FACT_COLUMNS, buildMainRaceFact({ race: RACE, result: RESULT, conditions: COND, series: SERIES, entries: ENTRIES }));
  for (const r of buildMainRunFacts(RACE, ENTRIES, { result: RESULT, timings: TIMINGS, exhibitions: EXHIBITIONS })) {
    await insert("run_facts", RUN_FACT_COLUMNS, r);
  }
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  try {
    const got = (await db.query("SELECT get_racer_runs(4001, '2025-12-03') AS j")).rows[0].j;
    assert.equal(got.length, 1);
    assert.equal(got[0].race.condition_source, "race_result");
    assert.equal(Number(got[0].race.wind_speed), 2.5);
  } finally {
    await db.exec("ROLLBACK");
  }
});
