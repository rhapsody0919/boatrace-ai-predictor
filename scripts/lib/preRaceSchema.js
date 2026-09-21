/**
 * 出走表・直前情報の新しい列（マイグレーション081・082）が、接続先のDBに適用済みかの判定
 *
 * 適用の前後どちらでも、A1（scripts/daily/update-race-info.js）・A2（scripts/daily/scrape-exhibition-data.js）が
 * 壊れないようにする。未適用の列は、行に含めない（旧実装と同じ列だけを書く）。判定の仕組みは
 * scripts/lib/schemaDetect.js（結果系の scripts/lib/raceResultSchema.js と同じ方式）。
 */

import { createSchemaDetector } from "./schemaDetect.js";

/** 判定の対象。081は race_entries と race_conditions の2表、082は exhibition_data */
export const PRE_RACE_SCHEMA_TARGETS = Object.freeze({
  raceEntries: {
    table: "race_entries",
    columns: [
      "weight_kg",
      "branch",
      "hometown",
      "f_count",
      "l_count",
      "is_absent",
    ],
    migration: "081",
  },
  raceConditions: {
    table: "race_conditions",
    columns: ["race_distance_m", "race_labels"],
    migration: "081",
  },
  exhibition: {
    table: "exhibition_data",
    columns: [
      "exhibition_course",
      "start_flag",
      "prev_finish_mark",
      "is_absent",
    ],
    migration: "082",
  },
});

const detector = createSchemaDetector(PRE_RACE_SCHEMA_TARGETS);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Parameters<typeof detector.detect>[1]} [options]
 * @returns {Promise<{raceEntries: boolean, raceConditions: boolean, exhibition: boolean}>}
 *   各テーブルの新しい列が適用済みか。確認に失敗したものは false
 */
export const detectPreRaceSchema = (client, options) =>
  detector.detect(client, options);

/** テスト用: キャッシュを捨てる */
export const clearPreRaceSchemaCache = (client) => detector.clear(client);

/** 未適用のDBに書くとき、行から除く列（optionalColumnGroups の値）。判定と書き込み失敗時の書き直しの両方に使う */
export const PRE_RACE_OPTIONAL_COLUMN_GROUPS = Object.freeze({
  raceEntries: {
    "マイグレーション081（出走表の追加列）": [
      ...PRE_RACE_SCHEMA_TARGETS.raceEntries.columns,
    ],
  },
  raceConditions: {
    "マイグレーション081（レースの距離・ラベル）": [
      ...PRE_RACE_SCHEMA_TARGETS.raceConditions.columns,
    ],
  },
  exhibition: {
    "マイグレーション082（直前情報の追加列）": [
      ...PRE_RACE_SCHEMA_TARGETS.exhibition.columns,
    ],
  },
});
