// マイグレーション 214（選手の性別の表 racer_sex）が、superuser でない役で2回当てられ、1・2 以外の性別を拒み、anon・authenticated から読めないことを守る（docs/design/data-gaps/db-draft.md §1.5）
//   - NOSUPERUSER の役で1つのトランザクションずつ2回当てて落ちない（冪等）
//   - sex が NULL・0・3 の行、source_fan が NULL の行は拒まれる。1・2 は入る。racer_id の重なりは拒まれる
//   - RLS が有効で、anon・authenticated の SELECT は permission denied
//   - db-apply の検査（inspectMigration）で拒否が無い
// 外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { inspectMigration } from "../lib/dbApplySql.js";
import { RACER_SEX_MIGRATION_SQL as SQL_214 } from "./verifyData/racer-sex-migration-file.js";

const ROLES =
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE applier NOSUPERUSER;" +
  " GRANT CREATE, USAGE ON SCHEMA public TO applier; GRANT anon, authenticated, service_role TO applier;" +
  " GRANT USAGE ON SCHEMA public TO anon, authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE applier IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;";
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
const insert = (db, id, sex, fan = "fan2604") =>
  db.query("INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES ($1, $2, $3)", [id, sex, fan]);

async function fresh() {
  const db = new PGlite();
  await db.exec(ROLES);
  await applyAs(db, SQL_214);
  return db;
}

test("db-apply の検査で拒否が無い", () => {
  assert.deepEqual(inspectMigration(SQL_214).rejections, []);
});

test("superuser でない役で2回当てて落ちない", async () => {
  const db = await fresh();
  await applyAs(db, SQL_214);
  const cols = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'racer_sex' ORDER BY ordinal_position",
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ["racer_id", "sex", "source_fan", "created_at", "updated_at"]);
});

test("性別は 1・2 だけ、source_fan は必須、racer_id は1人1行", async () => {
  const db = await fresh();
  await insert(db, 4001, 1);
  await insert(db, 4002, 2);
  assert.ok(await rejects(db, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4003, NULL, 'fan2604')"), "NULL");
  assert.ok(await rejects(db, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4004, 0, 'fan2604')"), "0");
  assert.ok(await rejects(db, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4005, 3, 'fan2604')"), "3");
  assert.ok(await rejects(db, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4006, 1, NULL)"), "source_fan NULL");
  assert.ok(await rejects(db, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4001, 2, 'fan2610')"), "重なり");
  const n = await db.query("SELECT count(*)::int AS n FROM racer_sex");
  assert.equal(n.rows[0].n, 2);
});

test("RLS が有効で、anon・authenticated からは読めない（既定の権限で SELECT が付く場合も）", async () => {
  const db = await fresh();
  await insert(db, 4001, 2);
  const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'racer_sex'");
  assert.equal(rls.rows[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    assert.ok(await rejects(db, `BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM racer_sex;`), `${role} の SELECT`);
    assert.ok(
      await rejects(db, `BEGIN; SET LOCAL ROLE ${role}; INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (9, 1, 'f');`),
      `${role} の INSERT`,
    );
  }
});
