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
