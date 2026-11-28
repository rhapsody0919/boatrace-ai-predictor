/**
 * facts の表（race_facts・run_facts、ADR-0113）の本体の期間の始まり。scripts/lib/kbArchiveBoundary.js の MAIN_TABLES_START と
 * 同じ値（verify-racer-history-from-facts.js が照合する）。src から scripts は読めないので写しを持つ。
 * 選手ページの履歴を facts に移した最初の段は、窓の始まりをこれより前にしない（今と同じ範囲にする。kb の期間まで伸ばすのは
 * 部品ごとのオーナーの before/after の後、docs/design/past-data-backfill/plan.md §6）
 */
export const FACTS_MAIN_ERA_START = "2025-12-03";
