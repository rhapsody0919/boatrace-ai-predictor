/**
 * 前検タイムの定期取得（motorPretestJob.js）の純関数: 取得の窓の日付・会場ごとの充足の引き継ぎと集計・last_report の形。
 * DB・ネットワークに触れない。
 */
/** 対象日の翌日・6日前（純関数） */
export function fetchWindow(date) {
  const dayMs = Date.parse(`${date}T00:00:00Z`);
  return {
    nextDate: new Date(dayMs + 86400000).toISOString().slice(0, 10),
    oldest: new Date(dayMs - 6 * 86400000).toISOString().slice(0, 10),
  };
}

/** 書き込み済みで今回取らなかった会場の集計を前回の last_report から引き継ぎ、今回の集計と合わせる（純関数） */
export function mergeCoverage({
  settledVenues,
  previousReport,
  date,
  mode,
  coverageByVenue,
}) {
  // 同じ日の補足の起動は、書き込み済みの会場を再取得しない。その会場の集計は、前回の last_report から引き継ぐ
  const settled = new Set(settledVenues);
  const sameDayLive =
    previousReport?.date === date && previousReport?.mode === mode;
  const carried = (sameDayLive ? (previousReport.coverage ?? []) : [])
    .filter(
      (c) => settled.has(c.venueCode) && !coverageByVenue.has(c.venueCode),
    )
    .map((c) => ({ ...c, pageRows: c.pageRows ?? 0 }));
  return [
    ...carried,
    ...[...coverageByVenue.entries()].map(([venueCode, c]) => ({
      venueCode,
      ...c,
    })),
  ].sort((a, b) => a.venueCode - b.venueCode);
}

/** 期待の選手・前検タイムの充足の集計（純関数） */
export function coverageSummary(expected, coverage) {
  return {
    venuesInRaces: expected.venues.length,
    racesInDb: expected.raceCount,
    excludedCancelledRaces: expected.excludedCancelledRaces,
    expectedRacers: coverage.reduce((n, c) => n + c.expected, 0),
    expectedRacersOnPage: coverage.reduce(
      (n, c) => n + (c.expected - c.missing.length),
      0,
    ),
    pageRows: coverage.reduce((n, c) => n + c.pageRows, 0),
    pretestFilled: coverage.reduce((n, c) => n + c.pretestFilled, 0),
  };
}

/** last_report に残す会場ごとの集計（純関数） */
export const reportCoverage = (coverage) =>
  coverage.map((c) => ({
    venueCode: c.venueCode,
    pageRows: c.pageRows,
    expected: c.expected,
    // 通知の判定に使うため、人数分を残す（1会場で数人。上限は念のため）
    missing: c.missing.slice(0, 30),
    pretestFilled: c.pretestFilled,
  }));
