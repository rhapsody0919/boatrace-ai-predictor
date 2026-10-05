/**
 * verify-analogy-v16-snapshots-migration.js - マイグレーション133（BOA-271 v16 T3-1: analogy_v16_snapshots）の検証。
 * インメモリの Postgres（PGlite）に本番と同じロール・076 の既定権限・races の縮約版を作り、
 * docs/db-migration/133_analogy_v16_snapshots.sql を適用して次を確かめる。本番 DB には接続しない。
 *
 *   (a) RLS が有効で、anon・authenticated は SELECT できる
 *   (b) anon・authenticated は INSERT・UPDATE・DELETE できない（権限が無い）
 *   (c) service_role は書ける。主キー (race_id, stage) の重複は ON CONFLICT DO NOTHING で1行のまま
 *   (d) CHECK: 段ごとの列の約束（racecard はハッシュ必須・exact なし・absent なし。exhibition は absent か exact あり）
 *   (e) races に無い race_id は書けない（外部キー）
 *   (f) 2回適用しても失敗しない（冪等）
 *   (g) ロールバック SQL（末尾のコメント）で表が消える
 *
 * 実行: node scripts/maintenance/verify-analogy-v16-snapshots-migration.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/133_analogy_v16_snapshots.sql",
);
const sql = fs.readFileSync(MIGRATION, "utf8");

const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- 076: postgres が作る新規テーブルに anon・authenticated の権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
CREATE TABLE public.races (race_id varchar PRIMARY KEY);
INSERT INTO public.races VALUES ('2026-09-27-20-12'), ('2026-09-27-20-11');
`;

const RACECARD = `INSERT INTO public.analogy_v16_snapshots
  (race_id, stage, run_id, pool_cutoff, model_version, n_layer, status, racecard_hash)
  VALUES ('2026-09-27-20-12', 'racecard', 'r1', '2026-09-26', '2026-10-05', 7286, 'ok', 'h1')`;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function asRole(db, role, query) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query(query);
    return null;
  } catch (e) {
    return e;
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function rejects(db, query) {
  try {
    await db.query(query);
    return false;
  } catch {
    return true;
  }
}

const rollbackSql = sql
  .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
  .split("\n")
  .map((l) => l.replace(/^-- ?/, ""))
  .join("\n");

const db = new PGlite();
await db.exec(FIXTURE_SQL);
await db.exec(sql);

// (a)
const rls = await db.query(
  "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analogy_v16_snapshots'::regclass",
);
check("(a) RLS が有効", rls.rows[0]?.relrowsecurity === true);

// (c) service_role の書き込みと重複
check(
  "(c) service_role は書ける",
  (await asRole(db, "service_role", RACECARD)) === null,
);
const dup = await asRole(
  db,
  "service_role",
  `INSERT INTO public.analogy_v16_snapshots
     (race_id, stage, run_id, pool_cutoff, n_layer, status, exact)
   VALUES ('2026-09-27-20-12', 'exhibition', 'r2', '2026-09-26', 7286, 'ok', true),
          ('2026-09-27-20-12', 'exhibition', 'r3', '2026-09-26', 7286, 'ok', false)
   ON CONFLICT (race_id, stage) DO NOTHING`,
);
const n = await db.query(
  "SELECT stage, run_id FROM public.analogy_v16_snapshots ORDER BY stage",
);
check(
  "(c) 主キーの重複は ON CONFLICT DO NOTHING で先の1行だけ",
  dup === null &&
    JSON.stringify(n.rows) ===
      JSON.stringify([
        { stage: "exhibition", run_id: "r2" },
        { stage: "racecard", run_id: "r1" },
      ]),
  JSON.stringify(n.rows),
);

// (a)(b) 匿名・authenticated
for (const role of ["anon", "authenticated"]) {
  await db.exec(`SET ROLE ${role}`);
  const rows = await db.query(
    "SELECT count(*)::int AS c FROM public.analogy_v16_snapshots",
  );
  await db.exec("RESET ROLE");
  check(`(a) ${role} は SELECT できる`, rows.rows[0].c === 2);
  for (const [op, q] of [
    ["INSERT", RACECARD.replace("20-12", "20-11")],
    ["UPDATE", "UPDATE public.analogy_v16_snapshots SET n_layer = 0"],
    ["DELETE", "DELETE FROM public.analogy_v16_snapshots"],
  ]) {
    const err = await asRole(db, role, q);
    check(
      `(b) ${role} は ${op} できない`,
      err !== null && /permission denied/.test(err.message),
      err?.message ?? "成功してしまった",
    );
  }
}

// (d) 段ごとの列の約束
const bad = [
  [
    "racecard にハッシュが無い",
    `('2026-09-27-20-11','racecard','r','2026-09-26',1,'ok',NULL,NULL)`,
  ],
  [
    "racecard に exact がある",
    `('2026-09-27-20-11','racecard','r','2026-09-26',1,'ok',true,'h')`,
  ],
  [
    "racecard に absent",
    `('2026-09-27-20-11','racecard','r','2026-09-26',0,'absent',NULL,'h')`,
  ],
  [
    "exhibition の ok に exact が無い",
    `('2026-09-27-20-11','exhibition','r','2026-09-26',1,'ok',NULL,NULL)`,
  ],
  [
    "exhibition にハッシュがある",
    `('2026-09-27-20-11','exhibition','r','2026-09-26',1,'ok',true,'h')`,
  ],
  [
    "未知の stage",
    `('2026-09-27-20-11','result','r','2026-09-26',1,'ok',NULL,'h')`,
  ],
  [
    "未知の status",
    `('2026-09-27-20-11','racecard','r','2026-09-26',1,'error',NULL,'h')`,
  ],
  [
    "n_layer が負",
    `('2026-09-27-20-11','racecard','r','2026-09-26',-1,'ok',NULL,'h')`,
  ],
  [
    "run_id が空",
    `('2026-09-27-20-11','racecard','','2026-09-26',1,'ok',NULL,'h')`,
  ],
];
const COLS =
  "(race_id, stage, run_id, pool_cutoff, n_layer, status, exact, racecard_hash)";
for (const [label, values] of bad) {
  check(
    `(d) CHECK で拒否: ${label}`,
    await rejects(
      db,
      `INSERT INTO public.analogy_v16_snapshots ${COLS} VALUES ${values}`,
    ),
  );
}
check(
  "(d) exhibition の absent は exact なしで書ける",
  !(await rejects(
    db,
    `INSERT INTO public.analogy_v16_snapshots ${COLS} VALUES ('2026-09-27-20-11','exhibition','r','2026-09-26',0,'absent',NULL,NULL)`,
  )),
);

// (e)
check(
  "(e) races に無い race_id は書けない",
  await rejects(
    db,
    `INSERT INTO public.analogy_v16_snapshots ${COLS} VALUES ('2099-01-01-01-01','racecard','r','2026-09-26',1,'ok',NULL,'h')`,
  ),
);

// (f)
let again = null;
try {
  await db.exec(sql);
} catch (e) {
  again = e;
}
check("(f) 2回適用しても失敗しない", again === null, again?.message);
const after = await db.query(
  "SELECT count(*)::int AS c FROM public.analogy_v16_snapshots",
);
check("(f) 2回目の適用で行が消えない", after.rows[0].c === 3);

// (g)
check("(g) ロールバック SQL がある", Boolean(rollbackSql));
await db.exec(rollbackSql);
const gone = await db.query(
  "SELECT to_regclass('public.analogy_v16_snapshots') AS t",
);
check("(g) ロールバックで表が消える", gone.rows[0].t === null);

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の失敗`);
  process.exit(1);
}
console.log("\n✅ マイグレーション133の検証に合格");
