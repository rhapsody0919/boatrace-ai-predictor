// 折れ線の入力。古い期から順に左→右。出走0の期は winRate が null のまま点を置かない
export const buildChartData = (periodRows) =>
  [...periodRows]
    .reverse()
    .map((r) => ({ label: r.label, range: r.range, winRate: r.winRate }));

export const chartRates = (chartData) =>
  chartData.map((d) => d.winRate).filter((v) => v !== null);
