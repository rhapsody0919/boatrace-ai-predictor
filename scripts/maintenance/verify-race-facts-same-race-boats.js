// マイグレーション 213（facts に同じレースの6艇の選手と着の並び、匿名の RPC が出たレースの6艇を返す）が、superuser でない役で当てられ、1トランザクションに1選手の守りを保ち、その選手の出たレースだけを返すことを守る（ADR-0113 決定4 の追記 2026-11-27）
//   - 212→213→213 を NOSUPERUSER の役で1つのトランザクションずつ当てられる。表が空でなければ 213 は落ちる（racer_ids NOT NULL）
//   - racer_ids は6本・添字1から、finish_order は6本・艇番 1〜6（中の NULL は許す）
//   - 設定が空なら両表とも0行。選手 12 を立てると、12 の出たレースの6艇と1レースだけ。他のレースは出ない
//   - get_racer_runs は本人の走に、同じレースの6艇（boats、艇番の順）と finish_order を添え、呼んだ後に設定を空に戻す
//   - db-apply の検査（inspectMigration）で拒否が無い
// 外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { inspectMigration } from "../lib/dbApplySql.js";
import { RACE_FACTS_MIGRATION_SQL, RACE_FACTS_SAME_RACE_SQL } from "./verifyData/race-facts-migration-files.js";

const SQL_212 = RACE_FACTS_MIGRATION_SQL;
const SQL_213 = RACE_FACTS_SAME_RACE_SQL;

const ROLES =
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE applier NOSUPERUSER;" +
  " GRANT CREATE, USAGE ON SCHEMA public TO applier; GRANT anon, authenticated, service_role TO applier;";
const applyAs = (db, sql) => db.exec(`BEGIN; SET LOCAL ROLE applier; ${sql} COMMIT;`);
const rejects = async (db, q, p = []) => {
  try {
    await db.query(q, p);
    return false;
  } catch {
    await db.exec("ROLLBACK").catch(() => {});
    return true;
  }
};
const count = async (db, t) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;

async function seed(db) {
  const race = async (id, racers, order) => {
    await db.query(
      "INSERT INTO race_facts(race_id, era, race_date, venue_code, race_number, has_result, rule_version, racer_ids, finish_order) VALUES ($1, 'main', $2, $3, $4, true, 1, $5, $6)",
      [id, id.slice(0, 10), Number(id.slice(11, 13)), Number(id.slice(14, 16)), racers, order],
    );
    for (let b = 1; b <= 6; b += 1) {
      await db.query(
        "INSERT INTO run_facts(race_id, boat_number, era, race_date, racer_id, rule_version, start_timing, exhibition_time) VALUES ($1, $2, 'main', $3, $4, 1, $5, $6)",
        [id, b, id.slice(0, 10), racers[b - 1], 0.1 + b / 100, 6.7 + b / 100],
      );
    }
  };
  await race("2026-11-20-01-01", [11, 12, 13, 14, 15, 16], [2, 1, 3, 4, 5, 6]);
  await race("2026-11-20-01-02", [21, 22, 23, 24, 25, 26], [1, 2, 3, 4, 5, null]);
}

test("db-apply の検査で拒否が無い", () => {
  assert.deepEqual(inspectMigration(SQL_213).rejections, []);
});

test("superuser でない役で当てられ、出たレースの6艇だけを返す", async () => {
  const db = new PGlite();
  await db.exec(ROLES);
  for (const sql of [SQL_212, SQL_213, SQL_213]) await applyAs(db, sql);
  await seed(db);
  assert.ok(await rejects(db, "UPDATE race_facts SET racer_ids = ARRAY[1,2,3,4,5] WHERE race_id = '2026-11-20-01-02'"), "6本でない");
  assert.ok(await rejects(db, "UPDATE race_facts SET racer_ids = '[0:5]={1,2,3,4,5,6}' WHERE race_id = '2026-11-20-01-02'"), "添字が0から");
  assert.ok(await rejects(db, "UPDATE race_facts SET racer_ids = NULL WHERE race_id = '2026-11-20-01-02'"), "NOT NULL");
  assert.ok(await rejects(db, "UPDATE race_facts SET finish_order = ARRAY[1,2,3,4,5,7]::smallint[] WHERE race_id = '2026-11-20-01-02'"), "艇番の外");
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  try {
    assert.equal(await count(db, "run_facts"), 0, "設定が空なら0行");
    assert.equal(await count(db, "race_facts"), 0);
    const runs = (await db.query("SELECT get_racer_runs(12, '2025-12-03') AS j")).rows[0].j;
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].boats.map((b) => b.racer_id), [11, 12, 13, 14, 15, 16]);
    assert.deepEqual(runs[0].race.finish_order, [2, 1, 3, 4, 5, 6]);
    assert.ok("start_timing" in runs[0].boats[0] && "exhibition_time" in runs[0].boats[0] && "is_flying" in runs[0].boats[0]);
    const v = (await db.query("SELECT current_setting('boatai.facts_racer_id', true) AS v")).rows[0].v;
    assert.equal(v ?? "", "", "呼んだ後に空");
    assert.deepEqual(await (await db.query("SELECT get_racer_runs(99, '2025-12-03') AS j")).rows[0].j, []);
    await db.query("SELECT set_config('boatai.facts_racer_id', '12', true)");
    assert.equal(await count(db, "run_facts"), 6, "自分で立てても出たレースの6艇まで");
    assert.equal(await count(db, "race_facts"), 1, "他のレースは出ない");
  } finally {
    await db.exec("ROLLBACK");
  }
});

test("表が空でなければ 213 は落ちる（racer_ids NOT NULL）", async () => {
  const db = new PGlite();
  await db.exec(ROLES);
  await applyAs(db, SQL_212);
  await db.query(
    "INSERT INTO race_facts(race_id, era, race_date, venue_code, race_number, has_result, rule_version) VALUES ('2026-11-20-01-01', 'main', '2026-11-20', 1, 1, true, 1)",
  );
  await assert.rejects(applyAs(db, SQL_213));
});
