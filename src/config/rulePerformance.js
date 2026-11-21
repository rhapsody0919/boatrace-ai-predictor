/**
 * 管理画面（/admin/rules）の運用成績の集計の起点の日付（BOA-567）。
 * 画面の整形（src/services/adminRulePerformance.js）と API（api/admin/rules/performance.js）が同じ値を読む。
 * api は src/services を読まない（依存の向き api-no-ui-data）ので、定数だけをここに置く。
 */
export const RULE_PERFORMANCE_START_DATE = "2026-01-16";
