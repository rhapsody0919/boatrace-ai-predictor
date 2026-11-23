/**
 * サイト全体のご意見ボックスの画面側の verify（verify-site-feedback.js）の部品。verify ではない。
 * 表のマイグレーション（docs/db-migration/NNN_site_feedback.sql）の本文と、台帳（APPLIED.md）を読む。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/db-migration",
);

/** @returns {{ file: string | undefined, sql: string | undefined, ledger: string }} 表のマイグレーションが無ければ file・sql は undefined */
export function readSiteFeedbackTable() {
  const file = fs
    .readdirSync(MIGRATION_DIR)
    .find((f) => /^\d+_site_feedback\.sql$/.test(f));
  return {
    file,
    sql: file
      ? fs.readFileSync(path.join(MIGRATION_DIR, file), "utf8")
      : undefined,
    ledger: fs.readFileSync(path.join(MIGRATION_DIR, "APPLIED.md"), "utf8"),
  };
}
