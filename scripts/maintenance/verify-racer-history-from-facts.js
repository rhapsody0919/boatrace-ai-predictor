// 選手ページの履歴を facts の RPC（get_racer_runs）から作る純関数（src/services/racerRaceHistoryFacts.js）が、今の本体の表からの整形
// （racerRaceHistoryRows.js の buildRacerRaceHistoryRows）と同じ字を返すことを守る（ADR-0113、移す前後の照らし）
// - 同じ本体の行から、(a) 今の整形、(b) facts の組み立て（raceFactsMain.js）→ 212・213 を流した PGlite → anon の RPC → 新しい整形、を作って全列を比べる
// - 許す差分は名指しの3つだけ（facts は 190 と同じ規則で広く埋める）: グレード（race_series・class_code）・題（race_series.title）・着欄（成績コード）
// - 窓の始まりの定数は scripts/lib/kbArchiveBoundary.js の MAIN_TABLES_START と同じ
// 外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { buildRacerRaceHistoryRows } from "../../src/services/racerRaceHistoryRows.js";
import { buildRacerHistoryRowsFromFacts } from "../../src/services/racerRaceHistoryFacts.js";
import { FACTS_MAIN_ERA_START } from "../../src/constants/factsEra.js";
import { MAIN_TABLES_START } from "../lib/kbArchiveBoundary.js";
import { RACE_FACT_COLUMNS, RUN_FACT_COLUMNS } from "../lib/raceFactsKb.js";
import { buildMainRaceFact, buildMainRunFacts } from "../lib/raceFactsMain.js";
import { RACE_FACTS_MIGRATION_SQL, RACE_FACTS_SAME_RACE_SQL } from "./verifyData/race-facts-migration-files.js";

const ME = 4320;
// 3レース: 普通の1着、F（着の付かない走・返還艇が rank に入る型）、不成立（除く）
const RACES = [
  { race_id: "2026-11-20-12-01", race_date: "2026-11-20", venue_code: 12, race_number: 1, start_time: "10:00:00", race_grade: "G1" },
  { race_id: "2026-11-21-12-05", race_date: "2026-11-21", venue_code: 12, race_number: 5, start_time: "12:00:00", race_grade: "G1" },
  { race_id: "2026-11-22-12-03", race_date: "2026-11-22", venue_code: 12, race_number: 3, start_time: "11:00:00", race_grade: "G1" },
];
const ENTRIES = RACES.flatMap((r, i) =>
  [1, 2, 3, 4, 5, 6].map((b) => ({ race_id: r.race_id, boat_number: b, racer_id: b === 2 + i ? ME : 5000 + b })),
);
const RESULTS = [
  { race_id: RACES[0].race_id, rank1: 2, rank2: 1, rank3: 3, rank4: 4, rank5: 5, rank6: 6, winning_technique: "差し", payout_win: 450, payout_place_1: 160, payout_place_2: 120, race_status: "normal", actual_course_2: 2 },
  { race_id: RACES[1].race_id, rank1: 1, rank2: 2, rank3: 4, rank4: 5, rank5: 6, rank6: 3, winning_technique: "逃げ", payout_win: 130, payout_place_1: 100, payout_place_2: 140, race_status: "normal" },
  { race_id: RACES[2].race_id, rank1: null, race_status: "no_race" },
];
const TIMINGS = RACES.flatMap((r, i) =>
  [1, 2, 3, 4, 5, 6].map((b) => ({
    race_id: r.race_id, boat_number: b, start_timing: i === 1 && b === 3 ? -0.02 : 0.1 + b / 100, is_flying: i === 1 && b === 3,
    finish_mark: i === 1 && b === 3 ? "F" : String(RESULTS[i].rank1 == null ? 1 : [RESULTS[i].rank1, RESULTS[i].rank2, RESULTS[i].rank3, RESULTS[i].rank4, RESULTS[i].rank5, RESULTS[i].rank6].indexOf(b) + 1),
    entry_course: b, official_finish_code: null,
  })),
);
const EXHIBITIONS = ENTRIES.map((e) => ({ race_id: e.race_id, boat_number: e.boat_number, exhibition_time: e.boat_number === 4 ? null : 6.7 + e.boat_number / 100 }));
const CONDITIONS = RACES.map((r) => ({ race_id: r.race_id, race_stage: "予選", race_title: "節の題", weather: "晴", wind_speed: 2, wave_height: 3, weather_observed_at: null }));

const byRace = (rows, id) => rows.filter((r) => r.race_id === id);

/** (a) 今の整形 */
function oldRows() {
  return buildRacerRaceHistoryRows({
    entries: ENTRIES.filter((e) => e.racer_id === ME),
    raceRows: RACES.map((r) => ({ race_id: r.race_id, venue_code: r.venue_code, race_grade: r.race_grade })),
    resultRows: RESULTS,
    exhibitionRows: EXHIBITIONS,
    conditionRows: CONDITIONS,
    stRows: TIMINGS,
  });
}

/** (b) facts を通した新しい整形 */
async function newRows(series = null) {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await db.exec(`BEGIN;${RACE_FACTS_MIGRATION_SQL}COMMIT;`);
  await db.exec(`BEGIN;${RACE_FACTS_SAME_RACE_SQL}COMMIT;`);
  const insert = (table, columns, row) =>
    db.query(`INSERT INTO ${table}(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => row[c]));
  for (const race of RACES) {
    const result = RESULTS.find((r) => r.race_id === race.race_id);
    const conditions = CONDITIONS.find((c) => c.race_id === race.race_id);
    const entries = byRace(ENTRIES, race.race_id);
    await insert("race_facts", RACE_FACT_COLUMNS, buildMainRaceFact({ race, result, conditions, series, entries }));
    for (const r of buildMainRunFacts(race, entries, { result, timings: byRace(TIMINGS, race.race_id), exhibitions: byRace(EXHIBITIONS, race.race_id) })) {
      await insert("run_facts", RUN_FACT_COLUMNS, r);
    }
  }
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  try {
    const runs = (await db.query("SELECT get_racer_runs($1, $2) AS j", [ME, FACTS_MAIN_ERA_START])).rows[0].j;
    return buildRacerHistoryRowsFromFacts(runs);
  } finally {
    await db.exec("ROLLBACK");
  }
}

// PGlite の numeric は文字列で届くことがあるので、数の列は数に直して比べる
const NUMERIC = ["windSpeed", "waveHeight", "exhibitionTime", "startTiming"];
const norm = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, NUMERIC.includes(k) && v != null ? Number(v) : v])));

test("窓の始まりは本体の期間の始まりと同じ", () => {
  assert.equal(FACTS_MAIN_ERA_START, MAIN_TABLES_START);
});

test("移す前後で同じ字（許す差分が出ない材料）", async () => {
  const before = norm(oldRows());
  const after = norm(await newRows());
  assert.equal(before.length, 2, "不成立のレースは除く");
  assert.deepEqual(after, before);
  assert.equal(after[0].stRank, 2, "レース内の ST 順位（本人は2号艇）");
  assert.equal(after[1].stRank, null, "F の艇は順位を付けない");
  assert.equal(after[1].isFlying, true);
  assert.equal(after[1].unranked, true, "F は着順に数えない");
  assert.equal(after[0].rank1, 2);
  assert.ok(after[0].othersExhibitionAvg > 0);
});

test("race_series があっても races.race_grade が先・空と null の扱い", async () => {
  const after = await newRows({ grade: null, class_code: "Lady", kind: "lady", title: "節の題" });
  assert.equal(after[0].raceGrade, "G1", "races.race_grade がある走は同じ");
  assert.throws(() => buildRacerHistoryRowsFromFacts(null), /配列ではない/);
  assert.deepEqual(buildRacerHistoryRowsFromFacts([]), []);
});
