/**
 * マイグレーション 210（選手ページの回収率の全国の基準、racer_boat_return_baseline）の verify
 * （verify-racer-boat-return-baseline.js）の部品。verify ではない。SQL の本文を読むだけ（site-feedback-migration.js と同じ形）。
 */
import { readFile } from "node:fs/promises";

export const MIGRATION_210_SQL = await readFile(
  new URL(
    "../../../docs/db-migration/210_racer_boat_return_baseline.sql",
    import.meta.url,
  ),
  "utf8",
);
