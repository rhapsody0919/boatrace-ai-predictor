/**
 * マイグレーション 208（サイト全体のご意見ボックスの表 site_feedback）の verify（verify-site-feedback-migration.js）の部品。
 * verify ではない。マイグレーションの本文と、末尾の注釈に書いた戻しの SQL を読む。
 * 画面をつなぐ PR の関門（verify-site-feedback-gate.js）も、ここから本文と台帳を読む。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/db-migration",
);
export const SITE_FEEDBACK_MIGRATION = "208_site_feedback.sql";
const MIGRATION = path.join(MIGRATION_DIR, SITE_FEEDBACK_MIGRATION);

/** @returns {{ sql: string, rollbackSql: string | undefined }} 戻しは ROLLBACK-BEGIN〜END の注釈の `-- ` を外した物 */
export function readSiteFeedbackMigration() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const rollbackSql = sql
    .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
    .split("\n")
    .map((l) => l.replace(/^-- ?/, ""))
    .join("\n");
  return { sql, rollbackSql };
}

/** 台帳（docs/db-migration/APPLIED.md）の本文。関門が isAppliedInLedger に渡す */
export function readMigrationLedger() {
  return fs.readFileSync(path.join(MIGRATION_DIR, "APPLIED.md"), "utf8");
}

/** 本番と同じロールと、076・166 の既定の権限（PGlite に先に当てる） */
export const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE claude_ro NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, claude_ro;
-- 076: postgres が作る新規テーブルに anon・authenticated の権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
-- Supabase の既定: service_role は新しい表を全部使える
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
-- 166: claude_ro は新しい public の表を既定で読める（この表では 208 が外す）
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO claude_ro;
`;

export const lit = (v) =>
  v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
export const key = (n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const BASE = {
  kind: "feature",
  comment: "モーターの成績も見たい",
  rating: 4,
  page_type: "race",
  lang: "ja",
  client_key: key(1),
};
export const insert = (row) =>
  `INSERT INTO public.site_feedback (kind, comment, rating, page_type, lang, client_key) VALUES (${lit(row.kind)}, ${lit(row.comment)}, ${row.rating ?? "NULL"}, ${lit(row.page_type)}, ${lit(row.lang)}, ${lit(row.client_key)})`;

export async function asRole(db, role, query) {
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
export const count = async (db) =>
  Number(
    (await db.query("SELECT count(*) AS n FROM public.site_feedback")).rows[0]
      .n,
  );
