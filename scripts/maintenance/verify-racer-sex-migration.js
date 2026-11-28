// マイグレーション 214（選手の性別の表 racer_sex）が、superuser でない役で2回当てられ、1・2 以外の性別を拒み、anon・authenticated から読めないことを守る（docs/design/data-gaps/db-draft.md §1.5）
//   - NOSUPERUSER の役で1つのトランザクションずつ2回当てて落ちない（冪等）
//   - sex が NULL・0・3 の行、source_fan が NULL の行は拒まれる。1・2 は入る。racer_id の重なりは拒まれる
//   - RLS が有効で、anon・authenticated の SELECT・INSERT は permission denied（既定の権限で ALL が付いても REVOKE で外れる）
//   - service_role は書き手の upsert（ON CONFLICT (racer_id) DO UPDATE）で書け、1人1行のまま
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
  " GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" +
  // 本番の既定に似せる: 076 より前の Supabase は anon・authenticated に ALL を付けていた。service_role は今も ALL
  " ALTER DEFAULT PRIVILEGES FOR ROLE applier IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;";
const applyAs = (db, sql) => db.exec(`BEGIN; SET LOCAL ROLE applier; ${sql} COMMIT;`);
const rejects = async (db, q, p = []) => {
  try {
    await db.query(q, p);
    return false;
  } catch {
    return true;
  }
};
/** 役を切り替えて1文を流し、permission denied で落ちたかを返す（PGlite の query は複数の文を受け付けないので、役は exec で替える） */
const deniedAs = async (db, role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query(q);
    return false;
  } catch (e) {
    assert.match(String(e?.message), /permission denied/, `${role} のエラーは権限の拒否であること: ${e?.message}`);
    return true;
  } finally {
    await db.exec("RESET ROLE");
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

test("RLS が有効で、anon・authenticated からは読めない（既定の権限で ALL が付いても）", async () => {
  const db = await fresh();
  await insert(db, 4001, 2);
  const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'racer_sex'");
  assert.equal(rls.rows[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    assert.ok(await deniedAs(db, role, "SELECT * FROM racer_sex"), `${role} の SELECT`);
    assert.ok(await deniedAs(db, role, "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (9, 1, 'f')"), `${role} の INSERT`);
  }
});

test("service_role は書き手の upsert で書け、1人1行のまま", async () => {
  const db = await fresh();
  await db.exec("SET ROLE service_role");
  const upsert = (sex, fan) =>
    db.query(
      "INSERT INTO racer_sex(racer_id, sex, source_fan) VALUES (4001, $1, $2) ON CONFLICT (racer_id) DO UPDATE SET sex = EXCLUDED.sex, source_fan = EXCLUDED.source_fan, updated_at = now()",
      [sex, fan],
    );
  await upsert(2, "fan2504");
  await upsert(2, "fan2510");
  const rows = (await db.query("SELECT racer_id, sex, source_fan, updated_at IS NOT NULL AS updated FROM racer_sex")).rows;
  await db.exec("RESET ROLE");
  assert.deepEqual(rows, [{ racer_id: 4001, sex: 2, source_fan: "fan2510", updated: true }]);
});
