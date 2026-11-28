/**
 * マイグレーション 214（選手の性別の表 racer_sex）の verify（verify-racer-sex-migration.js）の部品。verify ではない。
 * ファイルの本文を読むだけ（race-facts-migration-files.js と同じ形）。
 */
import { readFileSync } from "node:fs";

/** マイグレーション 214 の本文 */
export const RACER_SEX_MIGRATION_SQL = readFileSync(
  new URL("../../../docs/db-migration/214_racer_sex.sql", import.meta.url),
  "utf8",
);
