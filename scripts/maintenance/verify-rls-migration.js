/**
 * verify-rls-migration.js - マイグレーション076（BOA-370: RLS無効テーブルの匿名書き込みの是正）の検証。
 * インメモリのPostgres（PGlite）に、本番と同じ形のロール（anon/authenticated/service_role）・
 * 既定権限・テーブル・ビュー・RPCの縮約版を作り、docs/db-migration/076_enable_rls_on_public_tables.sql を
 * 実際に適用して、次を確認する。本番DBには接続しない（本番へは匿名キーでの書き込み試験もしない）。
 *
 * 確認すること:
 *   (0) 適用前: 対象16テーブルで anon の INSERT/UPDATE/DELETE が通る（脆弱な状態を再現できている）。
 *       自動更新可能なビュー経由で、RLS有効テーブルにも anon が書ける（ビュー迂回の再現）
 *   (a) 適用後: 対象16テーブル・RLS有効済みテーブルへの anon/authenticated の
 *       INSERT/UPDATE/DELETE/TRUNCATE が、権限エラー(42501)で拒否される（0行更新ではなく権限で止まる）
 *   (b) 読み取りが要るテーブル(READ_TABLES)は anon/authenticated が SELECT できる。
 *       読み取りが不要なテーブル(HIDDEN_TABLES)は anon から不可視（権限エラー）
 *   (c) SECURITY INVOKER のRPC（展示・気象・ST系の縮約版）を anon が呼んでも、行が返る
 *       （SELECTポリシーの付け忘れで画面が空になる退行を検知する）
 *   (d) service_role は全テーブルで INSERT/UPDATE/DELETE/SELECT できる（スクレイパーが影響を受けない）
 *   (e) ビューは SELECT のみ。書き込みは拒否、security_invoker=true でRLSの行制限が効く
 *   (f) 匿名から呼べた書き込み系RPC（update_venue_stats）が anon から呼べない
 *   (g) 適用後に postgres が作る新規テーブルに、anon/authenticated の権限が付かない（既定権限の抑止）
 *   (h) 2回適用しても失敗しない（再実行可能）
 *   (i) ロールバックSQL（マイグレーション末尾のコメント）を適用すると、適用前の状態に戻る
 *
 * 前提: HIDDEN_TABLES / READ_TABLES は、フロントエンド・api/・RPCの読み取り経路の監査結果
 * （マイグレーションのヘッダーコメントの表）と一致させる。監査結果が変わったら、ここも更新すること。
 *
 * 実行: npm run verify:rls-migration（@electric-sql/pglite はdevDependency）
 *       別のSQLを検証する場合は --migration=<path>（このスクリプトの検出力の確認用）
 * 注意: 検証対象はPGlite上の縮約フィクスチャ。本番の関数本体・実データは検証しない
 *       （本番側の確認は、マイグレーション末尾の「確認SQL」を適用後に実行する）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// --migration=<path> で別のSQLを検証できる（このスクリプト自体の検出力の確認用）
const migrationArg = process.argv.find((a) => a.startsWith("--migration="));
const MIGRATION = migrationArg
  ? path.resolve(migrationArg.slice("--migration=".length))
  : path.join(__dirname, "../../docs/db-migration/076_enable_rls_on_public_tables.sql");

/** 監査結果: anon/authenticatedが読む経路があるテーブル（SELECTポリシーが要る） */
export const READ_TABLES = [
  "exhibition_data",
  "race_conditions",
  "race_odds",
  "race_start_timings",
  "racer_aggregated_stats",
  "racer_series_points",
  "venue_motor_stats",
  "model_performance_daily",
];
/** 監査結果: 読む経路が無いテーブル（RLS有効＋ポリシー無し＝anonから不可視） */
export const HIDDEN_TABLES = [
  "bet_filters",
  "daily_bet_summary",
  "model_experiments",
  "race_notices_health",
  "race_special_notes",
  "rule_applications",
  "venue_entry_course_stats",
  "venue_rules",
];
const TARGET_TABLES = [...READ_TABLES, ...HIDDEN_TABLES];

/** 既にRLS有効で、SELECTポリシーを持つ既存テーブル（フィクスチャ）。書き込み権限の剥奪だけ確認する */
const EXISTING_RLS_TABLES = ["races", "models", "user_visible_summary"];
/** RLS有効・ポリシー無しの既存テーブル（sns_*相当） */
const EXISTING_HIDDEN_TABLES = ["sns_drafts"];

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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabaseの既定: postgresが作る新規テーブル・関数に、anon/authenticated/service_roleの全権限が付く
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 対象16テーブル（RLS無効・ポリシー無し）
${TARGET_TABLES.map(
  (t) =>
    `CREATE TABLE public.${t} (id serial PRIMARY KEY, race_id text, note text);`,
).join("\n")}

-- RLS有効済みの既存テーブル（本番と同じくSELECTポリシーのみ）
CREATE TABLE public.races (id serial PRIMARY KEY, race_id text, note text);
ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.races FOR SELECT USING (true);
CREATE TABLE public.models (id serial PRIMARY KEY, race_id text, note text, model_id text, is_public boolean, status text);
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.models FOR SELECT USING (is_public = true);
CREATE TABLE public.user_visible_summary (id serial PRIMARY KEY, race_id text, note text);
ALTER TABLE public.user_visible_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.user_visible_summary FOR SELECT USING (true);
-- RLS有効・ポリシー無し（sns_*相当。anonからは見えない）
CREATE TABLE public.sns_drafts (id serial PRIMARY KEY, race_id text, note text);
ALTER TABLE public.sns_drafts ENABLE ROW LEVEL SECURITY;

-- ビュー（所有者=postgres。本番のpostgresはBYPASSRLS。ここではsuperuserで同じ挙動）
CREATE VIEW public.v_production_models AS
  SELECT id, model_id, is_public, status FROM public.models
  WHERE status = 'production' AND is_public = true;
CREATE VIEW public.v_performance_comparison AS
  SELECT id, note FROM public.user_visible_summary;
CREATE VIEW public.v_prediction_performance AS
  SELECT count(*) AS total FROM public.races;

-- SECURITY INVOKER のRPC（本番の get_race_exhibition_trend / get_today_races 等の縮約版）
CREATE FUNCTION public.get_race_exhibition_trend(p_race_id text) RETURNS json
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(json_agg(e.note), '[]'::json) FROM public.exhibition_data e WHERE e.race_id = p_race_id
$$;
CREATE FUNCTION public.get_today_races() RETURNS json
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(json_agg(json_build_object('race_id', r.race_id, 'cond', c.note)), '[]'::json)
  FROM public.races r LEFT JOIN public.race_conditions c ON c.race_id = r.race_id
$$;
CREATE FUNCTION public.get_race_st_predictability(p_race_id text) RETURNS json
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT COALESCE(json_agg(t.note), '[]'::json)
  FROM public.race_start_timings t JOIN public.exhibition_data e ON e.race_id = t.race_id
  WHERE t.race_id = p_race_id
$$;
-- 匿名から呼べた書き込み系RPC（本番の update_venue_stats 相当）
CREATE FUNCTION public.update_venue_stats() RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN UPDATE public.races SET note = 'updated'; END $$;
`;

const SEED_SQL = `
${TARGET_TABLES.map(
  (t) => `INSERT INTO public.${t} (race_id, note) VALUES ('R1', 'seed-${t}');`,
).join("\n")}
INSERT INTO public.races (race_id, note) VALUES ('R1', 'race-note');
INSERT INTO public.models (model_id, is_public, status) VALUES
  ('public-prod', true, 'production'), ('private-prod', false, 'production');
INSERT INTO public.user_visible_summary (note) VALUES ('summary');
INSERT INTO public.sns_drafts (note) VALUES ('draft');
`;

/** ロールバックSQL: マイグレーション末尾の「ROLLBACK-BEGIN 〜 ROLLBACK-END」内のコメントを外して取り出す */
export function extractRollbackSql(migrationSql) {
  const m = migrationSql.match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/);
  if (!m) return null;
  return m[1]
    .split("\n")
    .map((line) => line.replace(/^-- ?/, ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// ロール切替つきの実行ヘルパー。各操作を SAVEPOINT で囲み、結果を {ok, code, rows} で返す
// ---------------------------------------------------------------------------
async function as(db, role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try {
    const res = await db.query(sql);
    return { ok: true, rows: res.rows, affected: res.affectedRows ?? 0 };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await db.exec("RESET ROLE");
  }
}

const WRITE_STATEMENTS = (table) => ({
  INSERT: `INSERT INTO public.${table} (race_id, note) VALUES ('X', 'attack')`,
  UPDATE: `UPDATE public.${table} SET note = 'attack'`,
  DELETE: `DELETE FROM public.${table}`,
  TRUNCATE: `TRUNCATE public.${table}`,
});

async function freshDb() {
  const db = new PGlite();
  await db.exec(FIXTURE_SQL);
  await db.exec(SEED_SQL);
  return db;
}

const migrationSql = fs.readFileSync(MIGRATION, "utf8");
const rollbackSql = extractRollbackSql(migrationSql);

// ---------------------------------------------------------------------------
// (0) 適用前: 脆弱な状態の再現
// ---------------------------------------------------------------------------
console.log("--- (0) 適用前の状態（脆弱性の再現）---");
{
  const db = await freshDb();
  for (const role of ["anon", "authenticated"]) {
    const failed = [];
    for (const t of TARGET_TABLES) {
      const s = WRITE_STATEMENTS(t);
      const ins = await as(db, role, s.INSERT);
      const upd = await as(db, role, s.UPDATE);
      const del = await as(db, role, s.DELETE);
      if (!(ins.ok && upd.ok && del.ok)) failed.push(t);
    }
    check(
      `適用前: ${role} が対象16テーブルに INSERT/UPDATE/DELETE できる（脆弱性を再現）`,
      failed.length === 0,
      `書き込めなかった: ${failed.join(",")}`,
    );
  }
  // RLS有効テーブルは、直接は書けない（UPDATE/DELETEは0行）が、自動更新可能なビュー経由だと書ける
  const direct = await as(
    db,
    "anon",
    "UPDATE public.models SET status = 'attack' RETURNING id",
  );
  check(
    "適用前: RLS有効のmodelsへの直接UPDATEは0行（RLSが効いている）",
    direct.ok && direct.rows.length === 0,
    JSON.stringify(direct),
  );
  const viaView = await as(
    db,
    "anon",
    "UPDATE public.v_production_models SET status = 'attack' RETURNING id",
  );
  check(
    "適用前: 自動更新可能なビュー経由だとmodelsをanonが書き換えられる（RLS迂回を再現）",
    viaView.ok && viaView.rows.length >= 1,
    JSON.stringify(viaView),
  );
  await db.close();
}

// ---------------------------------------------------------------------------
// (a)〜(g) 適用後
// ---------------------------------------------------------------------------
console.log("--- 適用後の状態 ---");
const db = await freshDb();
try {
  await db.exec(migrationSql);
} catch (e) {
  console.error(`[NG] マイグレーションの適用に失敗: ${e.message}`);
  process.exit(1);
}
check("マイグレーション076をPGliteに適用できる", true);

const rlsState = await db.query(`
  SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'`);
const rlsByTable = new Map(rlsState.rows.map((r) => [r.relname, r.rls]));
check(
  "(a0) 対象16テーブルのRLSが有効",
  TARGET_TABLES.every((t) => rlsByTable.get(t) === true),
  TARGET_TABLES.filter((t) => rlsByTable.get(t) !== true).join(","),
);
check(
  "(a0) publicの全テーブルでRLSが有効",
  [...rlsByTable.values()].every((v) => v === true),
  [...rlsByTable]
    .filter(([, v]) => !v)
    .map(([k]) => k)
    .join(","),
);

// (a) 書き込みが権限エラーで拒否される
for (const role of ["anon", "authenticated"]) {
  const notDenied = [];
  for (const t of [
    ...TARGET_TABLES,
    ...EXISTING_RLS_TABLES,
    ...EXISTING_HIDDEN_TABLES,
  ]) {
    const s = WRITE_STATEMENTS(t);
    for (const [kind, sql] of Object.entries(s)) {
      const r = await as(db, role, sql);
      if (r.ok || r.code !== "42501") notDenied.push(`${t}:${kind}`);
    }
  }
  check(
    `(a) ${role} の INSERT/UPDATE/DELETE/TRUNCATE が全テーブルで権限エラー(42501)`,
    notDenied.length === 0,
    notDenied.slice(0, 6).join(","),
  );
}

// (b) 読み取り
for (const role of ["anon", "authenticated"]) {
  const bad = [];
  for (const t of [...READ_TABLES, ...EXISTING_RLS_TABLES]) {
    const r = await as(db, role, `SELECT count(*)::int AS n FROM public.${t}`);
    if (!r.ok || r.rows[0].n < 1) bad.push(t);
  }
  check(
    `(b) ${role} が READ_TABLES・既存の公開テーブルを SELECT でき、行が見える`,
    bad.length === 0,
    bad.join(","),
  );
  const visible = [];
  for (const t of [...HIDDEN_TABLES, ...EXISTING_HIDDEN_TABLES]) {
    const r = await as(db, role, `SELECT count(*)::int AS n FROM public.${t}`);
    if (r.ok || r.code !== "42501") visible.push(t);
  }
  check(
    `(b) ${role} から HIDDEN_TABLES・sns_*相当は不可視（権限エラー）`,
    visible.length === 0,
    visible.join(","),
  );
}
const modelsAnon = await as(db, "anon", "SELECT model_id FROM public.models");
check(
  "(b) modelsは既存ポリシー(is_public)どおり公開行だけが見える",
  modelsAnon.ok &&
    modelsAnon.rows.length === 1 &&
    modelsAnon.rows[0].model_id === "public-prod",
  JSON.stringify(modelsAnon),
);

// (c) SECURITY INVOKER のRPC
for (const role of ["anon", "authenticated"]) {
  const trend = await as(
    db,
    role,
    "SELECT public.get_race_exhibition_trend('R1') AS j",
  );
  check(
    `(c) ${role} が get_race_exhibition_trend（exhibition_dataを読む）で行を得る`,
    trend.ok &&
      JSON.stringify(trend.rows[0].j).includes("seed-exhibition_data"),
    JSON.stringify(trend),
  );
  const today = await as(db, role, "SELECT public.get_today_races() AS j");
  check(
    `(c) ${role} が get_today_races（race_conditionsを読む）で気象行を得る`,
    today.ok &&
      JSON.stringify(today.rows[0].j).includes("seed-race_conditions"),
    JSON.stringify(today),
  );
  const st = await as(
    db,
    role,
    "SELECT public.get_race_st_predictability('R1') AS j",
  );
  check(
    `(c) ${role} が get_race_st_predictability（race_start_timings・exhibition_dataを読む）で行を得る`,
    st.ok && JSON.stringify(st.rows[0].j).includes("seed-race_start_timings"),
    JSON.stringify(st),
  );
}

// (d) service_role
{
  const bad = [];
  for (const t of TARGET_TABLES) {
    const s = WRITE_STATEMENTS(t);
    const sel = await as(
      db,
      "service_role",
      `SELECT count(*)::int AS n FROM public.${t}`,
    );
    const ins = await as(db, "service_role", s.INSERT);
    const upd = await as(db, "service_role", s.UPDATE);
    const del = await as(db, "service_role", s.DELETE);
    if (!(sel.ok && ins.ok && upd.ok && del.ok)) bad.push(t);
  }
  check(
    "(d) service_role は対象16テーブルで SELECT/INSERT/UPDATE/DELETE できる（スクレイパーに影響なし）",
    bad.length === 0,
    bad.join(","),
  );
  const sns = await as(
    db,
    "service_role",
    "SELECT count(*)::int AS n FROM public.sns_drafts",
  );
  check(
    "(d) service_role は sns_drafts を読める",
    sns.ok && sns.rows[0].n === 1,
  );
}

// (e) ビュー
{
  const sel = await as(
    db,
    "anon",
    "SELECT model_id FROM public.v_production_models",
  );
  check(
    "(e) anon は v_production_models を SELECT でき、公開行だけが見える",
    sel.ok && sel.rows.length === 1 && sel.rows[0].model_id === "public-prod",
    JSON.stringify(sel),
  );
  const notDenied = [];
  // 自動更新可能なビューのみ（v_prediction_performance は集計ビューで、元から書き込み不可）
  for (const v of ["v_production_models", "v_performance_comparison"]) {
    for (const [kind, sql] of Object.entries({
      INSERT: `INSERT INTO public.${v} DEFAULT VALUES`,
      UPDATE: `UPDATE public.${v} SET id = id`,
      DELETE: `DELETE FROM public.${v}`,
    })) {
      for (const role of ["anon", "authenticated"]) {
        const r = await as(db, role, sql);
        if (r.ok || r.code !== "42501") notDenied.push(`${role}:${v}:${kind}`);
      }
    }
  }
  check(
    "(e) anon/authenticated の ビューへの INSERT/UPDATE/DELETE が権限エラー(42501)",
    notDenied.length === 0,
    notDenied.slice(0, 6).join(","),
  );
  const opts = await db.query(`
    SELECT relname, reloptions FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'v'`);
  check(
    "(e) 全ビューが security_invoker=true",
    opts.rows.length === 3 &&
      opts.rows.every((r) =>
        (r.reloptions ?? []).includes("security_invoker=true"),
      ),
    JSON.stringify(opts.rows),
  );
}

// (f) 書き込み系RPC
{
  const anon = await as(db, "anon", "SELECT public.update_venue_stats()");
  check(
    "(f) anon は update_venue_stats() を呼べない（権限エラー）",
    !anon.ok && anon.code === "42501",
    JSON.stringify(anon),
  );
  const svc = await as(
    db,
    "service_role",
    "SELECT public.update_venue_stats()",
  );
  check(
    "(f) service_role は update_venue_stats() を呼べる",
    svc.ok,
    JSON.stringify(svc),
  );
}

// (g) 既定権限
{
  await db.exec(
    "CREATE TABLE public.future_table (id serial PRIMARY KEY, note text)",
  );
  const priv = await db.query(`
    SELECT has_table_privilege('anon', 'public.future_table', 'SELECT') AS a_sel,
           has_table_privilege('anon', 'public.future_table', 'INSERT') AS a_ins,
           has_table_privilege('authenticated', 'public.future_table', 'SELECT') AS u_sel,
           has_table_privilege('authenticated', 'public.future_table', 'INSERT') AS u_ins,
           has_table_privilege('service_role', 'public.future_table', 'INSERT') AS s_ins`);
  const p = priv.rows[0];
  check(
    "(g) 適用後に作る新規テーブルは、anon/authenticatedに権限が付かない（service_roleには付く）",
    !p.a_sel && !p.a_ins && !p.u_sel && !p.u_ins && p.s_ins,
    JSON.stringify(p),
  );
}

// (h) 再実行可能
{
  let ok = true;
  let detail = "";
  try {
    await db.exec(migrationSql);
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  check("(h) マイグレーションを2回適用しても失敗しない", ok, detail);
}

// (i) ロールバック
{
  if (!rollbackSql) {
    check("(i) ロールバックSQLがマイグレーション末尾にある", false);
  } else {
    let ok = true;
    let detail = "";
    try {
      await db.exec(rollbackSql);
    } catch (e) {
      ok = false;
      detail = e.message;
    }
    check("(i) ロールバックSQLを適用できる", ok, detail);
    const back = [];
    for (const t of TARGET_TABLES) {
      const r = await as(db, "anon", WRITE_STATEMENTS(t).INSERT);
      if (!r.ok) back.push(t);
    }
    check(
      "(i) ロールバック後は適用前の状態に戻る（対象16テーブルにanonが書き込める）",
      back.length === 0,
      back.join(","),
    );
    const rls = await db.query(
      `
      SELECT count(*)::int AS n FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) AND relrowsecurity`,
      [TARGET_TABLES],
    );
    check("(i) ロールバック後は対象16テーブルのRLSが無効", rls.rows[0].n === 0);
    const opts = await db.query(`
      SELECT reloptions FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = 'v_production_models'`);
    check(
      "(i) ロールバック後は security_invoker が解除される",
      !(opts.rows[0].reloptions ?? []).includes("security_invoker=true"),
      JSON.stringify(opts.rows[0]),
    );
  }
}

await db.close();

if (failures > 0) {
  console.error(`\n${failures} 件の検証に失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
