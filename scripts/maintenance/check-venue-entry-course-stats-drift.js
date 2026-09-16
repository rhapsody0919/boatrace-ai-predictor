#!/usr/bin/env node
/**
 * GitHub Actions（scrape-venue-entry-course-stats.yml）から呼ばれる、
 * 進入コース別選手成績ページ（BOA-293、FR-6 Phase 6c）のHTML構造変化検知。
 *
 * driftHealth.jsのSTRUCTURAL_DRIFT_REASONSはvenue_motor_stats固有のreason
 * コードに決め打ちされているため、reasonコード分類のみ本FR用に再定義する
 * （updateVenueHealthコアとDRIFT_ALERT_THRESHOLD_DAYSは再利用、
 * check-race-notices-drift.jsと同じ設計方針）。
 *
 * 新規のHTTPリクエストは行わない（scrape-venue-entry-course-stats.jsが同じ
 * ワークフロー実行内で更新したdata/analysis/venue-entry-course-stats-health.json
 * を読むだけ）。
 *
 * no_active_meet（本日の出走スケジュールがあるのに会場サイトが「次節開催まで
 * お待ちください」を返す状態）はサイト側の一時的な非公開・開催中止・自社
 * スケジュールとの日ズレでも起こりうるため、構造変化としては扱わない
 * （STRUCTURAL_DRIFT_REASONSに含めない）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRIFT_ALERT_THRESHOLD_DAYS } from "../lib/venueMotorStats/driftHealth.js";
import { VENUE_ENTRY_COURSE_STATS_CONFIG } from "../lib/venueEntryCourseStats/venueConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEALTH_FILE_PATH = path.join(
  __dirname,
  "../../data/analysis/venue-entry-course-stats-health.json",
);

const STRUCTURAL_DRIFT_REASONS = new Set([
  "entry_course_table_not_found",
  "unexpected_table_header",
  "no_data_rows",
]);

function isStructuralDriftReason(reason) {
  return reason != null && STRUCTURAL_DRIFT_REASONS.has(reason);
}

function findEntryCourseStatsDriftAlerts(health) {
  return Object.entries(health)
    .filter(
      ([, entry]) =>
        entry.consecutiveFailDays >= DRIFT_ALERT_THRESHOLD_DAYS &&
        isStructuralDriftReason(entry.lastReason),
    )
    .map(([venueCode, entry]) => ({
      venueCode,
      consecutiveFailDays: entry.consecutiveFailDays,
      lastReason: entry.lastReason,
    }));
}

function main() {
  let health;
  try {
    health = JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    console.log(
      "履歴ファイルが見つかりません。今回はチェックをスキップします。",
    );
    process.exit(0);
  }

  const nameByCode = Object.fromEntries(
    VENUE_ENTRY_COURSE_STATS_CONFIG.map((v) => [String(v.venueCode), v.name]),
  );

  const alerts = findEntryCourseStatsDriftAlerts(health);
  if (alerts.length === 0) {
    console.log("✅ 構造変化の疑いがある会場はありません。");
    process.exit(0);
  }

  const lines = alerts.map(
    (a) =>
      `${nameByCode[a.venueCode] ?? `会場コード${a.venueCode}`}: ${a.lastReason} が ${a.consecutiveFailDays}日連続`,
  );
  console.log(lines.join("\n"));
  process.exit(1);
}

main();
