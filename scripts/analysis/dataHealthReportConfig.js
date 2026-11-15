// データ健全性レポート（data-health-report.js）の定数と、集計・描画で共有する小さな純粋関数。
// data-health-report.js から移しただけ（定義・値は変えない）。

import {
  EXPECTED_UNPUBLISHED,
  laterOffsetsOf,
} from "../lib/scrapeJobs/expectedUnpublished.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

// 完了の定義（.claude/rules/data-acquisition.md）に基づく閾値
export const COVERAGE_THRESHOLD = 0.99;
export const WINDOW_THRESHOLD = 0.98;
export const COVERAGE_DAYS = 14;
export const WINDOW_DAYS = 7;
export const WINDOW_MINUTES = [60, 30, 15, 10, 5, 0];
// 窓の中心±この分数に取得が入れば、窓内（窓内取得率の定義）
export const WINDOW_TOLERANCE_MIN = 3;
// 想定内の未公開の対象の窓（発走の何分前か）と、その後続の窓（発走に近い窓）
export const EXPECTED_UNPUBLISHED_MINUTES = -EXPECTED_UNPUBLISHED.offsetMin;
export const LATER_WINDOW_MINUTES = laterOffsetsOf(SCRAPE_JOBS.odds).map(
  (o) => -o,
);
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// 窓内取得率の「除外した値」に使う既知の障害期間（除外しない値も常に併記する）。
// 障害が発生したら追記する。集計期間外の障害は結果に影響しない。ISO 8601（オフセット付き）で書く
export const KNOWN_INCIDENTS = [
  {
    label:
      "BOA-352 Supabase障害（statement timeout。オーケストレーターが早期終了）",
    start: "2026-09-16T18:04:00+09:00",
    end: "2026-09-16T21:58:00+09:00",
  },
];
// 取得時刻列の有無を確認する主要テーブル
export const TIMING_TABLES = [
  "races",
  "race_entries",
  "race_conditions",
  "race_results",
  "race_start_timings",
  "exhibition_data",
  "race_odds",
  "predictions",
  "prediction_odds",
  "race_special_notes",
  "racer_series_points",
  "racer_profiles",
  "venue_entry_course_stats",
  "venue_motor_stats",
  "race_notices_health",
];
// 取得のたびに上書きされる列（初回の取得時刻ではなく、最終書き込み時刻を表す）
export const OVERWRITTEN_ON_UPSERT = new Set(["result_at", "predicted_at"]);

export const rate = (numerator, denominator) =>
  denominator === 0 ? null : numerator / denominator;

export const formatPct = (value) =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

export const weekdayOf = (dateStr) =>
  WEEKDAY_LABELS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];

/** その日が、指標の期待件数の対象か（sinceより前は、取得開始前で対象外） */
export const isApplicableDay = (metric, dateStr) =>
  metric.since === undefined || dateStr >= metric.since;

/** 指標ごとの、その日の分母。対象外の日は0 */
export const metricDenominator = (metric, dayRow) =>
  isApplicableDay(metric, dayRow.d)
    ? Number(dayRow[metric.denomKey ?? "denom"])
    : 0;

export const tableRow = (cells) => `| ${cells.join(" | ")} |`;
export const tableHeader = (cells) =>
  `${tableRow(cells)}\n${tableRow(cells.map(() => "---"))}`;

export const formatBytes = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
