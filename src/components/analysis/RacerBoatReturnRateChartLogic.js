/** RacerBoatReturnRateChart の純な計算（表示用の文字列・className） */

/** 率のセルの表示。null のときだけ noData（元の !== null の判定のまま） */
export function formatReturnRate(rate, noDataLabel) {
  return rate !== null ? `${rate.toFixed(0)}%` : noDataLabel;
}

/** 単勝の率のセルの className。最良は金枠、100%以上は緑（R1・R2） */
export function winReturnCellClassName(row, bestWinReturnBoats) {
  return `rate${
    bestWinReturnBoats.has(row.boat_number) && row.win_return_rate > 0
      ? " ind-best"
      : ""
  }${row.win_return_rate >= 100 ? " ind-good" : ""}`;
}
