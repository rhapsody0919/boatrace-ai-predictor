/**
 * verify-function-grants-migration.js - マイグレーション112（BOA-575: 関数・シーケンスの匿名権限の剥奪と
 * 既定権限の是正）の検証。インメモリのPostgres（PGlite）に、本番と同じ形のロール・既定権限・関数・
 * シーケンス・トリガーの縮約版を作り、docs/db-migration/112_revoke_anon_function_and_sequence_grants.sql を
 * 実際に適用して、次を確認する。本番DBには接続しない。
 *
 * 確認すること:
 *   (0) 適用前: 剥奪対象の6関数・シーケンスを anon が使える（本番の状態を再現できている）
 *   (a) 適用後: 剥奪対象の6関数を anon / authenticated が EXECUTE できない（呼ぶと 42501）
 *   (b) 適用後: 画面が呼ぶ7本の RPC は anon / authenticated が引き続き呼べる
 *   (c) 適用後: service_role は全関数を EXECUTE できる
 *   (d) 適用後: トリガー関数の EXECUTE を持たないロールが書き込んでも、トリガーは発火する
 *       （トリガーの発火は関数の EXECUTE を確かめない。スクレイパーの書き込みが壊れないことの実証）
 *   (e) 適用後: anon / authenticated のシーケンス権限が0
 *   (f) 適用後に postgres が作る新規関数・シーケンスに、anon / authenticated の権限が付かない。
 *       GRANT EXECUTE を明示すれば anon から呼べる（以後の RPC の書き方）
 *   (g) 2回適用しても失敗しない（冪等）
 *   (h) 末尾の検査（DOブロック）が、想定外の匿名 EXECUTE を見つけたら例外で全体を戻す
 *   (i) ロールバックSQL（マイグレーション末尾のコメント）で、適用前の状態に戻る
 *
 * 前提: KEEP_FUNCS / REVOKE_FUNCS は、マイグレーションのヘッダーコメントの監査結果と一致させる。
 *
 * 実行: npm run verify:function-grants-migration（@electric-sql/pglite はdevDependency）
 * 注意: 検証対象はPGlite上の縮約フィクスチャ。本番の関数本体は検証しない
 *       （本番側の確認は、マイグレーション末尾の「確認SQL」と check-anon-access.js --expect-applied）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/112_revoke_anon_function_and_sequence_grants.sql",
);

/** 匿名が呼ぶ RPC（EXECUTE を残す） */
const KEEP_FUNCS = [
  ["get_predictions_by_date", "target_date date"],
  ["get_predictions_by_date_light", "target_date date"],
  ["get_race_exhibition_trend", "p_race_id text"],
  ["get_race_return_rate", "p_race_id text"],
  ["get_race_st_predictability", "p_race_id text"],
  ["get_race_technique_profile", "p_race_id text"],
  ["get_today_races", ""],
];
/** 匿名から呼ぶ経路が無い（剥奪する）読み取り関数 */
const REVOKE_READ_FUNCS = [
  ["get_latest_racer_grades", ""],
  ["get_accuracy_summary", ""],
  ["get_race_history_summary", "days_back integer"],
];
/** 剥奪するトリガー関数 */
const TRIGGER_FUNCS = [
  "update_prediction_results",
  "trg_external_predictions_updated_at",
  "update_updated_at_column",
];
const REVOKE_FUNC_NAMES = [
  ...REVOKE_READ_FUNCS.map(([n]) => n),
  ...TRIGGER_FUNCS,
];

/** ロールバックSQL: マイグレーション末尾の「ROLLBACK-BEGIN 〜 ROLLBACK-END」内のコメントを外して取り出す
 * （verify-rls-migration.js と同じ。あちらは import 時に検証本体が走るため取り込まない） */
function extractRollbackSql(migrationSql) {
  const m = migrationSql.match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/);
  if (!m) return null;
  return m[1]
    .split("\n")
    .map((line) => line.replace(/^-- ?/, ""))
    .join("\n");
}

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`[OK] ${label}`);
  } else {
    failures++;
    console.error(`[NG] ${label}${detail ? ` (${detail})` : ""}`);
  }
}

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch (e) {
  console.error(
    `@electric-sql/pglite を読み込めません（npm install が必要）: ${e.message}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// フィクスチャ: 本番（Supabase）と同じ形のロール・既定権限・オブジェクトの縮約版
// ---------------------------------------------------------------------------
const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- トリガー関数の EXECUTE を持たない書き込みロール（(d) の実証用）
CREATE ROLE trigger_probe NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, trigger_probe;
-- Supabaseの既定（2026-10-01 本番の pg_default_acl と同じ）
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.races (race_id text PRIMARY KEY, note text);
CREATE TABLE public.predictions (
  id serial PRIMARY KEY, race_id text, top_pick int, is_hit boolean
);
CREATE TABLE public.race_results (race_id text PRIMARY KEY, rank1 int);
CREATE TABLE public.venue_rules (
  id serial PRIMARY KEY, note text, updated_at timestamptz
);
CREATE TABLE public.external_predictions (
  id serial PRIMARY KEY, note text, updated_at timestamptz
);
GRANT SELECT ON public.races, public.predictions, public.race_results TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, trigger_probe;

${KEEP_FUNCS.map(
  ([name, args]) =>
    `CREATE FUNCTION public.${name}(${args}) RETURNS json LANGUAGE sql STABLE AS $$ SELECT json_build_object('n', (SELECT count(*) FROM public.races)) $$;`,
).join("\n")}
${REVOKE_READ_FUNCS.map(
  ([name, args]) =>
    `CREATE FUNCTION public.${name}(${args}) RETURNS json LANGUAGE sql STABLE AS $$ SELECT json_build_object('n', (SELECT count(*) FROM public.predictions)) $$;`,
).join("\n")}

-- 本番の update_prediction_results 相当: 結果の INSERT で予想の的中を更新する
CREATE FUNCTION public.update_prediction_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.predictions SET is_hit = (top_pick = NEW.rank1) WHERE race_id = NEW.race_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_update_predictions AFTER INSERT ON public.race_results
  FOR EACH ROW EXECUTE FUNCTION public.update_prediction_results();
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER update_venue_rules_updated_at BEFORE UPDATE ON public.venue_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE FUNCTION public.trg_external_predictions_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER external_predictions_updated_at BEFORE UPDATE ON public.external_predictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_external_predictions_updated_at();

INSERT INTO public.races VALUES ('R1', 'x');
INSERT INTO public.predictions (race_id, top_pick) VALUES ('R1', 1), ('R2', 3);
INSERT INTO public.venue_rules (note) VALUES ('v');
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(FIXTURE_SQL);
  return db;
}

async function as(db, role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try {
    const res = await db.query(sql);
    return { ok: true, rows: res.rows };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function canExecute(db, role, name) {
  const r = await db.query(
    `SELECT bool_and(has_function_privilege($1, p.oid, 'EXECUTE')) AS ok
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $2`,
    [role, name],
  );
  return r.rows[0].ok === true;
}

async function sequenceGrantCount(db, role) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
       AND CASE WHEN c.relkind = 'S'
             THEN has_sequence_privilege($1, c.oid, 'USAGE,SELECT,UPDATE') ELSE false END`,
    [role],
  );
  return r.rows[0].n;
}

const migrationSql = fs.readFileSync(MIGRATION, "utf8");
const rollbackSql = extractRollbackSql(migrationSql);

// ---------------------------------------------------------------------------
// (0) 適用前
// ---------------------------------------------------------------------------
console.log("--- (0) 適用前の状態（本番の再現）---");
{
  const db = await freshDb();
  const exec = [];
  for (const n of REVOKE_FUNC_NAMES) exec.push(await canExecute(db, "anon", n));
  check(
    "適用前: 剥奪対象の6関数を anon が EXECUTE できる",
    exec.every(Boolean),
  );
  const call = await as(
    db,
    "anon",
    "SELECT public.get_race_history_summary(30)",
  );
  check(
    "適用前: anon が get_race_history_summary を呼べる",
    call.ok,
    call.message,
  );
  check(
    "適用前: anon にシーケンス権限がある",
    (await sequenceGrantCount(db, "anon")) > 0,
  );
  await db.close();
}

// ---------------------------------------------------------------------------
// (a)〜(f) 適用後
// ---------------------------------------------------------------------------
console.log("--- 適用後の状態 ---");
const db = await freshDb();
try {
  await db.exec(migrationSql);
  check("マイグレーションが成功する（末尾の検査を含む）", true);
} catch (e) {
  check("マイグレーションが成功する（末尾の検査を含む）", false, e.message);
}

for (const role of ["anon", "authenticated"]) {
  const still = [];
  for (const n of REVOKE_FUNC_NAMES)
    if (await canExecute(db, role, n)) still.push(n);
  check(
    `(a) ${role} は剥奪対象の6関数を EXECUTE できない`,
    still.length === 0,
    still.join(","),
  );
  const call = await as(db, role, "SELECT public.get_race_history_summary(30)");
  check(
    `(a) ${role} が get_race_history_summary を呼ぶと権限エラー(42501)`,
    !call.ok && call.code === "42501",
    JSON.stringify(call),
  );

  const broken = [];
  for (const [n, args] of KEEP_FUNCS) {
    const arg = args.startsWith("target_date")
      ? "'2026-10-01'"
      : args
        ? "'R1'"
        : "";
    const r = await as(db, role, `SELECT public.${n}(${arg}) AS j`);
    if (!r.ok) broken.push(`${n}:${r.code}`);
  }
  check(
    `(b) ${role} は画面が呼ぶ7本のRPCを呼べる`,
    broken.length === 0,
    broken.join(","),
  );
}

{
  const missing = [];
  for (const n of [...REVOKE_FUNC_NAMES, ...KEEP_FUNCS.map(([n]) => n)])
    if (!(await canExecute(db, "service_role", n))) missing.push(n);
  check(
    "(c) service_role は全関数を EXECUTE できる",
    missing.length === 0,
    missing.join(","),
  );
}

{
  check(
    "(d) 前提: trigger_probe はトリガー関数の EXECUTE を持たない",
    !(await canExecute(db, "trigger_probe", "update_prediction_results")) &&
      !(await canExecute(db, "trigger_probe", "update_updated_at_column")),
  );
  const ins = await as(
    db,
    "trigger_probe",
    "INSERT INTO public.race_results VALUES ('R1', 1)",
  );
  const hit = await db.query(
    "SELECT is_hit FROM public.predictions WHERE race_id = 'R1'",
  );
  check(
    "(d) EXECUTE の無いロールの INSERT でも update_prediction_results トリガーが発火する",
    ins.ok && hit.rows[0].is_hit === true,
    JSON.stringify({ ins, hit: hit.rows }),
  );
  const upd = await as(
    db,
    "trigger_probe",
    "UPDATE public.venue_rules SET note = 'w' RETURNING updated_at",
  );
  check(
    "(d) EXECUTE の無いロールの UPDATE でも update_updated_at_column トリガーが発火する",
    upd.ok && upd.rows[0].updated_at !== null,
    JSON.stringify(upd),
  );
}

for (const role of ["anon", "authenticated"]) {
  const n = await sequenceGrantCount(db, role);
  check(`(e) ${role} のシーケンス権限が0`, n === 0, `${n}件`);
}

{
  await db.exec(`
    CREATE FUNCTION public.new_rpc_after_112() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE SEQUENCE public.new_seq_after_112;
  `);
  check(
    "(f) 適用後に作る関数を anon は EXECUTE できない（既定権限の抑止）",
    !(await canExecute(db, "anon", "new_rpc_after_112")) &&
      !(await canExecute(db, "authenticated", "new_rpc_after_112")),
  );
  check(
    "(f) 適用後に作る関数を service_role は EXECUTE できる",
    await canExecute(db, "service_role", "new_rpc_after_112"),
  );
  check(
    "(f) 適用後に作るシーケンスに anon の権限が付かない",
    (await sequenceGrantCount(db, "anon")) === 0,
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.new_rpc_after_112() TO anon, authenticated",
  );
  const r = await as(db, "anon", "SELECT public.new_rpc_after_112() AS v");
  check(
    "(f) GRANT EXECUTE を明示すれば anon から呼べる",
    r.ok && r.rows[0].v === 1,
    JSON.stringify(r),
  );
  await db.exec(
    "DROP FUNCTION public.new_rpc_after_112(); DROP SEQUENCE public.new_seq_after_112;",
  );
}

try {
  await db.exec(migrationSql);
  check("(g) 2回適用しても失敗しない", true);
} catch (e) {
  check("(g) 2回適用しても失敗しない", false, e.message);
}

// ---------------------------------------------------------------------------
// (h) 末尾の検査の検出力: 想定外の匿名 EXECUTE があると例外で全体を戻す
// ---------------------------------------------------------------------------
{
  const db2 = await freshDb();
  // 既定権限で anon が呼べる、監査結果に無い関数（＝想定外）
  await db2.exec(
    "CREATE FUNCTION public.unexpected_rpc() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
  );
  let raised = null;
  try {
    await db2.exec(migrationSql);
  } catch (e) {
    raised = e.message;
  }
  check(
    "(h) 想定外の匿名 EXECUTE があると末尾の検査が例外を投げる",
    raised !== null && raised.includes("unexpected_rpc"),
    raised ?? "例外なし",
  );
  await db2.exec("ROLLBACK").catch(() => {});
  check(
    "(h) 例外時はトランザクション全体が戻る（剥奪対象を anon がまだ EXECUTE できる）",
    await canExecute(db2, "anon", "update_prediction_results"),
  );
  await db2.close();
}

// ---------------------------------------------------------------------------
// (i) ロールバックSQL
// ---------------------------------------------------------------------------
check("(i) ロールバックSQLがマイグレーション末尾にある", rollbackSql !== null);
if (rollbackSql) {
  await db.exec(rollbackSql);
  const back = [];
  for (const n of REVOKE_FUNC_NAMES)
    if (!(await canExecute(db, "anon", n))) back.push(n);
  check(
    "(i) ロールバック後は剥奪対象を anon が EXECUTE できる",
    back.length === 0,
    back.join(","),
  );
  check(
    "(i) ロールバック後は anon にシーケンス権限がある",
    (await sequenceGrantCount(db, "anon")) > 0,
  );
  await db.exec(
    "CREATE FUNCTION public.after_rollback() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
  );
  check(
    "(i) ロールバック後に作る関数は既定で anon が EXECUTE できる",
    await canExecute(db, "anon", "after_rollback"),
  );
}

await db.close();

if (failures > 0) {
  console.error(`\n${failures} 件の検証に失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
