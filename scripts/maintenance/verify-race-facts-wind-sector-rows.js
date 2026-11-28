// facts の書き手（raceFactsKb.js・raceFactsMain.js）が両方の era で race_facts.wind_sector を src/pure/windSector.js の5区分で埋め、条件が無ければ NULL にし、race と run の版を別に持ち、212 の CHECK を通ることを守る（data-gaps plan.md §3.1）
// - kb: K の本当の方位（kb_archive_races.wind_direction）を会場の offset で回す。main: race_conditions.wind_direction（画面の矢印の番号）をそのまま
// - condition_source が NULL なら wind_sector も NULL（212 の CHECK）。風向が無い・会場の外も NULL
// - race の版は RACE_FACTS_RULE_VERSION、run の版は RUN_FACTS_RULE_VERSION（片方の規則でもう片方の全行を書き直さない）
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  RACE_FACT_COLUMNS,
  RUN_FACT_COLUMNS,
  RACE_FACTS_RULE_VERSION,
  RUN_FACTS_RULE_VERSION,
  buildKbRaceFact,
  buildKbRunFacts,
} from "../lib/raceFactsKb.js";
import { buildMainRaceFact, buildMainRunFacts } from "../lib/raceFactsMain.js";
import { RACE_FACTS_MIGRATION_SQL, RACE_FACTS_SAME_RACE_SQL } from "./verifyData/race-facts-migration-files.js";

// 徳山（offset 14）: K の「北」は矢印 14 → 向かい風
const KB_RACE = {
  race_id: "2025-11-30-18-05", race_date: "2025-11-30", venue_code: 18, race_number: 5, stage: "予選",
  weather: "晴", wind_direction: "北", wind_speed: 5, wave_height: 4, has_result: true, dead_heat: false,
};
const KB_BOATS = [1, 2].map((b) => ({ race_id: KB_RACE.race_id, boat_number: b, racer_id: 4100 + b, finish_raw: `0${b}`, course: b }));
const kbMeta = { grade: "ippan", seriesKind: "ippan", boats: KB_BOATS };

const MAIN_RACE = { race_id: "2026-11-20-18-05", race_date: "2026-11-20", venue_code: 18, race_number: 5, start_time: "12:00:00", race_grade: "ippan" };
// 矢印「東」は会場によらず追い風
const MAIN_COND = { weather: "晴", wind_direction: "東", wind_speed: 4, wave_height: 3, weather_observed_at: "2026-11-20T03:00:00Z" };
const MAIN_ENTRIES = [1, 2].map((b) => ({ race_id: MAIN_RACE.race_id, boat_number: b, racer_id: 4100 + b }));

test("kb: K の方位を会場で回して5区分", () => {
  assert.equal(buildKbRaceFact(KB_RACE, null, kbMeta).wind_sector, "head_strong", "徳山の北5m");
  assert.equal(buildKbRaceFact({ ...KB_RACE, wind_speed: 3 }, null, kbMeta).wind_sector, "head");
  assert.equal(buildKbRaceFact({ ...KB_RACE, venue_code: 1, race_id: "2025-11-30-01-05", wind_direction: "北北西", wind_speed: 2 }, null, kbMeta).wind_sector, "tail",
    "桐生（offset 5）の北北西は追い風");
  assert.equal(buildKbRaceFact({ ...KB_RACE, wind_direction: "無風", wind_speed: 0 }, null, kbMeta).wind_sector, "calm_cross");
  assert.equal(buildKbRaceFact({ ...KB_RACE, wind_direction: null }, null, kbMeta).wind_sector, null, "風向が無い");
  const noCond = buildKbRaceFact({ ...KB_RACE, weather: null, wind_speed: null, wave_height: null }, null, kbMeta);
  assert.equal(noCond.condition_source, null);
  assert.equal(noCond.wind_sector, null, "条件が無ければ NULL");
});

test("main: 矢印の番号をそのまま5区分。出所が無ければ NULL", () => {
  const row = buildMainRaceFact({ race: MAIN_RACE, conditions: MAIN_COND, entries: MAIN_ENTRIES });
  assert.equal(row.condition_source, "race_result");
  assert.equal(row.wind_sector, "tail_strong", "矢印「東」4m");
  assert.equal(buildMainRaceFact({ race: MAIN_RACE, conditions: { ...MAIN_COND, wind_direction: "西", wind_speed: 2 } }).wind_sector, "head");
  assert.equal(buildMainRaceFact({ race: MAIN_RACE, conditions: { ...MAIN_COND, wind_direction: "北", wind_speed: 6 } }).wind_sector, "calm_cross", "横風");
  assert.equal(buildMainRaceFact({ race: MAIN_RACE, conditions: { ...MAIN_COND, wind_direction: null } }).wind_sector, null);
  assert.equal(buildMainRaceFact({ race: MAIN_RACE, conditions: { wind_direction: "東" } }).wind_sector, null, "風・波・天候が無く出所が NULL");
  assert.equal(buildMainRaceFact({ race: MAIN_RACE }).wind_sector, null);
});

test("版は表ごと: race は RACE_FACTS_RULE_VERSION、run は RUN_FACTS_RULE_VERSION", () => {
  assert.equal(RACE_FACTS_RULE_VERSION, 3);
  assert.equal(RUN_FACTS_RULE_VERSION, 2, "run の規則は変えていないので上げない（kb の run_facts を書き直さない）");
  assert.equal(buildKbRaceFact(KB_RACE, null, kbMeta).rule_version, 3);
  assert.equal(buildMainRaceFact({ race: MAIN_RACE, conditions: MAIN_COND }).rule_version, 3);
  for (const r of buildKbRunFacts(KB_RACE, KB_BOATS)) assert.equal(r.rule_version, 2);
  for (const r of buildMainRunFacts(MAIN_RACE, MAIN_ENTRIES)) assert.equal(r.rule_version, 2);
});

const db = new PGlite();
before(async () => {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec(`BEGIN;${RACE_FACTS_MIGRATION_SQL}${RACE_FACTS_SAME_RACE_SQL}COMMIT;`);
});
const insert = (table, columns, row) =>
  db.query(
    `INSERT INTO ${table}(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map((c) => row[c]),
  );

test("wind_sector の入った行・入らない行が 212 の CHECK を通る", async () => {
  const rows = [
    buildKbRaceFact(KB_RACE, null, kbMeta),
    buildKbRaceFact({ ...KB_RACE, race_id: "2025-11-30-18-06", race_number: 6, weather: null, wind_speed: null, wave_height: null }, null, kbMeta),
    buildMainRaceFact({ race: MAIN_RACE, conditions: MAIN_COND, entries: MAIN_ENTRIES }),
    buildMainRaceFact({ race: { ...MAIN_RACE, race_id: "2026-11-20-18-06", race_number: 6 }, conditions: { wind_direction: "東" } }),
  ];
  for (const r of rows) await insert("race_facts", RACE_FACT_COLUMNS, r);
  for (const r of [...buildKbRunFacts(KB_RACE, KB_BOATS), ...buildMainRunFacts(MAIN_RACE, MAIN_ENTRIES)]) {
    await insert("run_facts", RUN_FACT_COLUMNS, r);
  }
  const got = (await db.query("SELECT race_id, wind_sector, rule_version FROM race_facts ORDER BY race_id")).rows;
  assert.deepEqual(got.map((r) => [r.race_id, r.wind_sector, r.rule_version]), [
    ["2025-11-30-18-05", "head_strong", 3],
    ["2025-11-30-18-06", null, 3],
    ["2026-11-20-18-05", "tail_strong", 3],
    ["2026-11-20-18-06", null, 3],
  ]);
  await assert.rejects(
    insert("race_facts", RACE_FACT_COLUMNS, { ...rows[1], race_id: "2025-11-30-18-07", race_number: 7, wind_sector: "head" }),
    /check/i,
    "出所が NULL で wind_sector だけ入れると CHECK に当たる（書き手が NULL にする理由）",
  );
});
