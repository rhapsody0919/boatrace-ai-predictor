/**
 * マイグレーション 205（サイト全体のご意見ボックスの表 site_feedback）の verify（verify-site-feedback-migration.js）の部品。
 * verify ではない。マイグレーションの本文と、末尾の注釈に書いた戻しの SQL を読む。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/db-migration/205_site_feedback.sql",
);

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
