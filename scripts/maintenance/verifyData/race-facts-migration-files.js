/**
 * マイグレーション 212（過去データの facts の表、race_facts・run_facts・get_racer_runs ほか）の verify
 * （verify-race-facts-migration.js・verify-facts-racer-guc.js）の部品。verify ではない。ファイルの本文を読むだけ
 * （racer-boat-return-baseline-sql.js と同じ形）。
 */
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../../../docs/db-migration/", import.meta.url);

/** マイグレーション 212 の本文 */
export const RACE_FACTS_MIGRATION_SQL = readFileSync(
  new URL("../../../docs/db-migration/212_race_facts.sql", import.meta.url),
  "utf8",
);

/** 全てのマイグレーションの [ファイル名, 本文]（名前の順） */
export function readAllMigrations() {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [f, readFileSync(new URL(f, MIGRATION_DIR), "utf8")]);
}

/** schema-snapshot.json の関数の一覧 */
export function readSnapshotFunctions() {
  const text = readFileSync(
    new URL("../../../docs/reference/schema-snapshot.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(text).functions ?? [];
}
