import { aggregateRacerConditionStats } from "../../utils/racerConditionStats.js";

/**
 * 成績・調子の欄（#racer-stats）のクラス。調子のカード・全国勝率の推移・条件別の成績の3つがそろうときだけ PC の2列の並び
 * （RacerPerformanceStatsPc.css の .racer-stats-pc-pair）にする。条件は WinRateChart・RacerConditionStats が出る条件と同じ
 * （調子のカードは常に出る）。:has() は recharts が文字を測るたびの再計算を重くするので使わない（2026-11-26）
 */
export function racerStatsClassName(chartData, conditionHistory) {
  const hasCondition =
    !!conditionHistory &&
    aggregateRacerConditionStats(conditionHistory).rows.length > 0;
  return chartData.length > 0 && hasCondition
    ? "racer-performance-stats racer-stats-pc-pair"
    : "racer-performance-stats";
}
