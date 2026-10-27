/**
 * verify-function-search-path-migration.js - マイグレーション187（関数19本の search_path と analogy_feedback の流量の制限・連鎖）の検証。
 * インメモリの Postgres（PGlite）に、本番と同じロール・races の縮約版・143 の analogy_feedback と、
 * 19関数の同じ引数の仮の関数を作り、docs/db-migration/187_function_search_path_and_feedback_limits.sql を当てて次を確かめる。
 * 本番 DB には接続しない。
 *
 *   (a) ALTER FUNCTION の対象は本番の pg_proc で取った19本（名前と引数の型）と一致する
 *   (b) 19本とも proconfig が search_path=public, pg_temp になり、本文（md5(prosrc)）は変わらない
 *   (c) ガードは SECURITY DEFINER・search_path のまま、anon は今までどおり INSERT できる（SELECT はできない）
 *   (d) 全体で直近10分に30行を超える INSERT を拒む（client_key を毎回変えても止まる）
 *   (e) 10分より前の行は全体の上限に数えない。全体の24時間の上限は無い。数える前に advisory lock を取る
 *   (f) 同じ client_key の24時間40行の制限は残る
 *   (g) races を消すと声も消える（ON DELETE CASCADE、制約の名前は同じ）
 *   (h) 2回当てても失敗しない（冪等）
 *   (i) 戻し方（末尾のコメント）で search_path・143 の本文・NO ACTION に戻る
 *
 * 実行: node scripts/maintenance/verify-function-search-path-migration.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  fs.readFileSync(
    path.join(__dirname, "../../docs/db-migration", name),
    "utf8",
  );
const sql143 = read("143_analogy_feedback.sql");
const sql187 = read("187_function_search_path_and_feedback_limits.sql");

// 本番の pg_proc（2026-10-27、claude_ro）: public・plpgsql/sql・search_path 未設定・拡張の所有でない19本
const EXPECTED = [
  ["compute_nige_second_by_course", "", "sql"],
  ["compute_racer_course_technique_stats", "", "sql"],
  ["compute_st_course_baseline", "", "sql"],
  ["compute_venue_course_entry_baseline", "smallint, date", "sql"],
  ["compute_venue_course_technique_baseline", "", "sql"],
  ["get_accuracy_summary", "", "plpgsql"],
  ["get_latest_racer_grades", "", "sql"],
  ["get_predictions_by_date", "date", "plpgsql"],
  ["get_predictions_by_date_light", "date", "plpgsql"],
  ["get_race_exhibition_trend", "text", "sql"],
  ["get_race_history_summary", "integer", "plpgsql"],
  ["get_race_return_rate", "text", "sql"],
  ["get_race_st_predictability", "text", "sql"],
  ["get_race_technique_profile", "text", "sql"],
  ["get_today_races", "", "plpgsql"],
  ["trg_external_predictions_updated_at", "", "trigger"],
  ["update_prediction_results", "", "trigger"],
  ["update_updated_at_column", "", "trigger"],
  ["update_venue_stats", "", "plpgsql"],
];

const stub = ([name, args, kind]) =>
  kind === "trigger"
    ? `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.x := now(); RETURN NEW; END; $$;`
    : kind === "sql"
      ? `CREATE FUNCTION public.${name}(${args}) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;`
      : `CREATE FUNCTION public.${name}(${args}) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN '{}'::jsonb; END; $$;`;

const RACES = Array.from(
  { length: 40 },
  (_, i) => `'2026-10-08-01-${String(i + 1).padStart(2, "0")}'`,
);
const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
CREATE TABLE public.races (race_id varchar PRIMARY KEY);
INSERT INTO public.races VALUES ${RACES.map((r) => `(${r})`).join(", ")};
${EXPECTED.map(stub).join("\n")}
`;

const COLS =
  "(kind, race_id, verdict, analogy_stage, analogy_tab, lang, client_key)";
const key = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n, race = 1, kind = "vote") =>
  `INSERT INTO public.analogy_feedback ${COLS} VALUES ('${kind}', '2026-10-08-01-${String(race).padStart(2, "0")}', 'useful', 'exhibition', 'facts', 'ja', '${key(n)}')`;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

/** 複数の文（マイグレーションの全文）を流す */
async function attemptExec(db, text) {
  try {
    await db.exec(text);
    return null;
  } catch (e) {
    return e;
  }
}

async function attempt(db, query, role = null) {
  if (role) await db.exec(`SET ROLE ${role}`);
  try {
    await db.query(query);
    return null;
  } catch (e) {
    return e;
  } finally {
    if (role) await db.exec("RESET ROLE");
  }
}

/** トリガーを外して、created_at を指定した行を直に入れる（窓の外の行を作る） */
async function seed(db, rows) {
  await db.exec(
    "ALTER TABLE public.analogy_feedback DISABLE TRIGGER analogy_feedback_guard",
  );
  for (const { n, race, kind = "vote", ago } of rows) {
    await db.query(
      `INSERT INTO public.analogy_feedback ${COLS.replace(")", ", created_at)")} VALUES ($1, $2, 'useful', 'exhibition', 'facts', 'ja', $3, now() - $4::interval)`,
      [kind, `2026-10-08-01-${String(race).padStart(2, "0")}`, key(n), ago],
    );
  }
  await db.exec(
    "ALTER TABLE public.analogy_feedback ENABLE TRIGGER analogy_feedback_guard",
  );
}

const fnState = async (db) =>
  (
    await db.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, md5(p.prosrc) AS md5, p.proconfig
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`,
      [EXPECTED.map(([n]) => n)],
    )
  ).rows;

const fkState = async (db) =>
  (
    await db.query(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.analogy_feedback'::regclass AND contype = 'f'`,
    )
  ).rows;

const guardSrc = async (db) =>
  (
    await db.query(
      `SELECT prosrc, prosecdef, proconfig FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure`,
    )
  ).rows[0];

const rollbackSql = sql187
  .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
  .split("\n")
  .map((l) => l.replace(/^-- ?/, ""))
  .join("\n");

// (a)
const altered = [
  ...sql187
    .split("-- ROLLBACK-BEGIN")[0]
    .matchAll(
      /^ALTER FUNCTION public\.(\w+)\(([^)]*)\) SET search_path = public, pg_temp;$/gm,
    ),
].map((m) => `${m[1]}(${m[2]})`);
check(
  "(a) ALTER FUNCTION の対象は本番の19本と一致する",
  JSON.stringify(altered) ===
    JSON.stringify(EXPECTED.map(([n, a]) => `${n}(${a})`)),
  JSON.stringify(altered),
);

const db = new PGlite();
await db.exec(FIXTURE_SQL);
await db.exec(sql143);
const before = await fnState(db);
await db.exec(sql187);
const after = await fnState(db);

// (b)
check("(b) 19本ある", after.length === 19, String(after.length));
check(
  "(b) 19本とも search_path=public, pg_temp",
  after.every(
    (f) =>
      JSON.stringify(f.proconfig) ===
      JSON.stringify(["search_path=public, pg_temp"]),
  ),
  JSON.stringify(after.filter((f) => !f.proconfig).map((f) => f.proname)),
);
check(
  "(b) 本文（md5(prosrc)）は変わらない",
  JSON.stringify(before.map((f) => f.md5)) ===
    JSON.stringify(after.map((f) => f.md5)),
);
check(
  "(b) 引数の型は本番と同じ",
  JSON.stringify(after.map((f) => f.args)) ===
    JSON.stringify(EXPECTED.map(([, a]) => a)),
  JSON.stringify(after.map((f) => f.args)),
);

// (c)
const g = await guardSrc(db);
check(
  "(c) ガードは SECURITY DEFINER・search_path のまま",
  g.prosecdef === true &&
    JSON.stringify(g.proconfig) ===
      JSON.stringify(["search_path=public, pg_temp"]),
  JSON.stringify(g.proconfig),
);
check(
  "(c) anon は INSERT できる",
  (await attempt(db, row(1), "anon")) === null,
);
const sel = await attempt(db, "SELECT * FROM public.analogy_feedback", "anon");
check(
  "(c) anon は SELECT できない",
  sel !== null && /permission denied/.test(sel.message),
  sel?.message,
);

const guardMd5 = (
  await db.query(
    "SELECT md5(prosrc) AS h FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure",
  )
).rows[0].h;
check(
  "(c) ガードの md5 は適用後の確認に書いた値（識別に使う）",
  sql187.includes(`期待: ${guardMd5} |`),
  guardMd5,
);
const tx = sql187.split("-- ROLLBACK-BEGIN")[0];
check(
  "(g) races の ACCESS EXCLUSIVE を長く待たない（DROP CONSTRAINT より前に lock_timeout 1s）",
  /SET LOCAL lock_timeout = '1s';/.test(tx) &&
    tx.indexOf("SET LOCAL lock_timeout") < tx.indexOf("DROP CONSTRAINT IF EXISTS analogy_feedback_race_id_fkey"),
);

// (d) 10分に30行。空の表から30行は通り、31行目で止まる
await db.exec("DELETE FROM public.analogy_feedback");
let firstReject = null;
for (let n = 1; n <= 31; n++) {
  const err = await attempt(db, row(100 + n), "anon");
  if (err && firstReject === null) firstReject = { n, message: err.message };
}
check(
  "(d) client_key を毎回変えても、10分に30行で止まる",
  firstReject?.n === 31 && /too many overall/.test(firstReject.message),
  JSON.stringify(firstReject),
);

// (e) 10分の窓の外（11分前）に100行あっても通る。24時間の全体の上限は入れない（ファイル冒頭の判断）
await db.exec("DELETE FROM public.analogy_feedback");
await seed(
  db,
  Array.from({ length: 100 }, (_, i) => ({
    n: 1000 + i,
    race: (i % 40) + 1,
    ago: "11 minutes",
  })),
);
check(
  "(e) 10分より前の行は全体の上限に数えない",
  (await attempt(db, row(2000), "anon")) === null,
);
const body = (await guardSrc(db)).prosrc;
check(
  "(e) 全体の24時間の上限は無い（正規の声を最大24時間止めない）",
  !/now\(\) - interval '24 hours'\) >= 300/.test(body),
);
check(
  "(e) 数える前に advisory lock を取る（同時の INSERT で上限を越えない）",
  body.includes("pg_advisory_xact_lock") &&
    body.indexOf("pg_advisory_xact_lock") < body.indexOf("count(*)"),
);

// (f) 同じ client_key は24時間に40行
await db.exec("DELETE FROM public.analogy_feedback");
await seed(
  db,
  Array.from({ length: 40 }, (_, i) => ({
    n: 7,
    race: (i % 20) + 1,
    kind: i < 20 ? "vote" : "detail",
    ago: "1 hour",
  })),
);
const f41 = await attempt(db, row(7, 21), "anon");
check(
  "(f) 同じ client_key の41行目は止まる",
  f41 !== null && /too many from this client/.test(f41.message),
  f41?.message,
);

// (g)
await db.exec("DELETE FROM public.analogy_feedback");
await attempt(db, row(9, 40), "anon");
const fk = await fkState(db);
check(
  "(g) 外部キーは同じ名前で ON DELETE CASCADE",
  fk.length === 1 &&
    fk[0].conname === "analogy_feedback_race_id_fkey" &&
    fk[0].confdeltype === "c",
  JSON.stringify(fk),
);
const del = await attempt(
  db,
  "DELETE FROM public.races WHERE race_id = '2026-10-08-01-40'",
);
const left = (
  await db.query("SELECT count(*)::int AS n FROM public.analogy_feedback")
).rows[0].n;
check(
  "(g) races を消すと声も消える",
  del === null && left === 0,
  del?.message ?? `残り ${left} 行`,
);

// (h)
const once = JSON.stringify([await fnState(db), await fkState(db), (await guardSrc(db)).prosrc]);
check("(h) 2回当てても失敗しない", (await attemptExec(db, sql187)) === null);
check(
  "(h) 2回目の後も関数・外部キー・ガードの本文が1回目と同じ",
  JSON.stringify([await fnState(db), await fkState(db), (await guardSrc(db)).prosrc]) === once,
);

// (i)
check(
  "(i) 戻し方の SQL がある",
  typeof rollbackSql === "string" && rollbackSql.includes("RESET search_path"),
);
const rb = await attemptExec(db, rollbackSql);
check("(i) 戻し方が通る", rb === null, rb?.message);
check(
  "(i) 19本の search_path が外れる",
  (await fnState(db)).every((f) => f.proconfig === null),
);
const g2 = await guardSrc(db);
check(
  "(i) ガードは143の本文（1時間300行）に戻る",
  g2.prosrc.includes("interval '1 hour'") &&
    !g2.prosrc.includes("10 minutes") &&
    g2.prosecdef === true,
);
const fk2 = await fkState(db);
check(
  "(i) 外部キーは NO ACTION に戻る",
  fk2.length === 1 && fk2[0].confdeltype === "a",
  JSON.stringify(fk2),
);

await db.close();
if (failures > 0) {
  console.error(`verify-function-search-path-migration: ${failures} 件 NG`);
  process.exit(1);
}
console.log("verify-function-search-path-migration: すべて OK");
