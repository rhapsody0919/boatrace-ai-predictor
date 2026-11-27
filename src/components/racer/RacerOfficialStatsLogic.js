import { buildPeriodRows } from "../../pure/racerOfficialPeriodStats.js";
import { winRateAxis } from "../../utils/chartDomain";
// 折れ線の入力。古い期から順に左→右。出走0の期は winRate が null のまま点を置かない
export const buildChartData = (periodRows) =>
  [...periodRows].reverse().map((r) => ({
    label: r.label,
    range: r.range,
    winRate: r.winRate,
    starts: r.starts,
  }));

export const chartRates = (chartData) =>
  chartData.map((d) => d.winRate).filter((v) => v !== null);

/**
 * 成績・調子の欄の「勝率の推移（公式の期ごと）」の段の入力（P-12・P-21 を1つに、オーナー 2026-11-27）。
 * 期が2つ以上あり、出走のある期が1つでもあるときだけ中身を返す（無ければ空。図を出さず、PC の2列の並びにもしない）
 * @param {object[]|null|undefined} rows racer_period_stats の行
 */
export function winRateStepsData(rows) {
  const chartData = buildChartData(buildPeriodRows(rows ?? []));
  const rates = chartRates(chartData);
  if (chartData.length < 2 || rates.length === 0)
    return { chartData: [], rateAxis: null };
  return { chartData, rateAxis: winRateAxis(rates) };
}
