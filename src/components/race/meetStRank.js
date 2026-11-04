/**
 * 今節の有効STの平均と、この6艇の中の順位（1・1・3）。
 * @param {Array<{boat: number, runs: Array<{raceId: string, st: number|null, finish?: number|string}>}>} runsByBoat
 * @param {{beforeRaceId: string, minRuns?: number}} options
 */
export function rankMeetAvgSt(runsByBoat, { beforeRaceId, minRuns = 3 }) {
  const rows = runsByBoat.map(({ boat, runs }) => {
    const values = runs.filter((run) =>
      run.raceId < beforeRaceId && Number.isFinite(run.st) &&
      run.finish !== "F" && run.finish !== "L",
    ).map((run) => run.st);
    const n = values.length;
    const avg = n >= minRuns && n > 0
      ? values.reduce((sum, value) => sum + value, 0) / n
      : null;
    return { boat, avg, n, rank: null };
  });
  const rounded = rows.filter((row) => row.avg !== null)
    .map((row) => Math.round(row.avg * 1000));
  return rows.map((row) => ({
    ...row,
    rank: row.avg === null ? null
      : rounded.filter((value) => value < Math.round(row.avg * 1000)).length + 1,
  }));
}
