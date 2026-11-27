/**
 * マイグレーション 212（過去データの facts の表、race_facts・run_facts・get_racer_runs ほか）の verify
 * （verify-race-facts-migration.js・verify-facts-racer-guc.js）の部品。verify ではない。ファイルの本文を読むだけ
 * （racer-boat-return-baseline-sql.js と同じ形）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATION_DIR = process.env.RACE_FACTS_MIGRATION_DIR ?? "docs/db-migration";
const SNAPSHOT = process.env.RACE_FACTS_SNAPSHOT ?? "docs/reference/schema-snapshot.json";

/** NNN_race_facts.sql の本文（無ければ throw） */
export function readRaceFactsMigration() {
  const file = readdirSync(MIGRATION_DIR).find((f) => /^\d+_race_facts\.sql$/.test(f));
  if (!file) throw new Error(`${MIGRATION_DIR} に NNN_race_facts.sql が無い`);
  return readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
}

/** 全てのマイグレーションの [ファイル名, 本文]（名前の順） */
export function readAllMigrations() {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [f, readFileSync(path.join(MIGRATION_DIR, f), "utf-8")]);
}

/** schema-snapshot.json の関数の一覧 */
export function readSnapshotFunctions() {
  return JSON.parse(readFileSync(SNAPSHOT, "utf-8")).functions ?? [];
}
