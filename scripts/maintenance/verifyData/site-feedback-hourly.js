/**
 * マイグレーション 209（ご意見ボックスの時間ごとの件数 site_feedback_hourly）の verify（verify-site-feedback-hourly.js）の部品。
 * verify ではない。マイグレーションの本文と、末尾の注釈に書いた戻しの SQL を読む。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/db-migration/209_site_feedback_hourly.sql",
);

/** @returns {{ sql: string, rollbackSql: string | undefined }} */
export function readSiteFeedbackHourlyMigration() {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const rollbackSql = sql
    .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
    .split("\n")
    .map((l) => l.replace(/^-- ?/, ""))
    .join("\n");
  return { sql, rollbackSql };
}
