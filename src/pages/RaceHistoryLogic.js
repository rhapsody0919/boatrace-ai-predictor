// RaceHistory の純な計算（月ごとのまとめ・月の集計）

// サマリーRPCの days を画面で使う形にそろえる
export function toDateInfos(summary) {
  return (summary.days || []).map((day) => ({
    date: day.date,
    totalRaces: day.totalRaces || 0,
    finishedRaces: day.finishedRaces || 0,
    turnRaces: day.turnRaces || 0,
    turnHitRate: day.turnHitRate,
  }));
}

// 月別にグループ化。キーは並べ替えられる「YYYY-MM」にする（見出しの「2026年10月」を文字列で並べると
// 「10月」が「9月」より後ろに来る）。各月は日付の新しい順
export function groupByMonth(dates) {
  const grouped = {};
  dates.forEach((dateInfo) => {
    const yearMonth = dateInfo.date.slice(0, 7);
    if (!grouped[yearMonth]) {
      grouped[yearMonth] = [];
    }
    grouped[yearMonth].push(dateInfo);
  });

  Object.keys(grouped).forEach((month) => {
    grouped[month].sort((a, b) => b.date.localeCompare(a.date));
  });
  return grouped;
}

// 最新月のキー（無ければ undefined）
export function latestMonthOf(grouped) {
  return Object.keys(grouped).sort().reverse()[0];
}

// 月のサマリーを計算（展開予測的中率の月内平均）
export function getMonthSummary(dates) {
  const totalRaces = dates.reduce((sum, d) => sum + d.turnRaces, 0);
  let totalTurnHits = 0;
  dates.forEach((d) => {
    if (d.turnHitRate != null) {
      totalTurnHits += (d.turnHitRate / 100) * d.turnRaces;
    }
  });
  const avgTurnHitRate =
    totalRaces > 0 ? ((totalTurnHits / totalRaces) * 100).toFixed(1) : null;
  return { totalRaces, avgTurnHitRate, days: dates.length };
}
