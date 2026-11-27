// マイグレーション 212（facts の表と get_racer_runs）が、superuser でない役（本番の db-apply の postgres と同じ）でも当てられ、RPC の後に絞りの設定が残らないことを守る
// 最初の db-apply（2026-11-27、run 45937058925）は get_racer_runs の SET 句で「permission denied to set parameter」になった。
// PGlite は superuser で動くので、NOSUPERUSER の役に SET LOCAL ROLE して当てないと再現しない。
//   - NOSUPERUSER の役で全文を1つのトランザクションで当てられる
//   - anon が同じトランザクションの中で get_racer_runs を呼んだ後、boatai.facts_racer_id は空で、表を直に引くと0行
//   - db-apply の検査（inspectMigration）で拒否が無い
// 外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { RACE_FACTS_MIGRATION_SQL } from "./verifyData/race-facts-migration-files.js";
import { inspectMigration } from "../lib/dbApplySql.js";

const sql = RACE_FACTS_MIGRATION_SQL;

test("db-apply の検査で拒否が無い", () => {
  assert.deepEqual(inspectMigration(sql).rejections, []);
});

test("superuser でない役でも当てられ、RPC の後に設定が残らない", async () => {
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE applier NOSUPERUSER;" +
      " GRANT CREATE, USAGE ON SCHEMA public TO applier; GRANT anon, authenticated, service_role TO applier;",
  );
  await db.exec(`BEGIN; SET LOCAL ROLE applier; ${sql} COMMIT;`);
  await db.exec(
    "INSERT INTO run_facts(race_id, boat_number, era, race_date, racer_id, rule_version) VALUES ('2025-12-03-01-01', 1, 'main', '2025-12-03', 11, 1)",
  );
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  try {
    await db.query("SELECT get_racer_runs(11, '2019-04-01')");
    const v = (await db.query("SELECT current_setting('boatai.facts_racer_id', true) AS v")).rows[0].v;
    assert.equal(v ?? "", "", "同じトランザクションの中でも空に戻す");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM run_facts")).rows[0].n, 0);
  } finally {
    await db.exec("ROLLBACK");
  }
});
