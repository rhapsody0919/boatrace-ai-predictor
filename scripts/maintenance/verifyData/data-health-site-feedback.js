/**
 * data_health の ご意見ボックスの見張りの verify（verify-data-health-site-feedback.js）の部品。verify ではない。
 * マイグレーション 211 の本文を読む。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/db-migration/211_data_health_site_feedback.sql",
);

/** @returns {string} */
export function readDataHealthSiteFeedbackMigration() {
  return fs.readFileSync(MIGRATION, "utf8");
}
