/** お気に入り選手の出走と、出走が無いときの会場表示（GS04-5）。 */
const compareRaces = (a, b) =>
  (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0) ||
  a.venueCode - b.venueCode ||
  a.raceNumber - b.raceNumber;

/**
 * getPredictions の races（平らな配列、選手は players）を buildFavoriteRuns の入力
 * （会場別・選手は entries）にまとめる。トップの venuesData（get_today_races の形）は
 * racerId・raceId を持たないので使えない（BOA-1272、#2225 でトップが落ちた原因）。
 */
export function venuesFromPredictions(races) {
  const venues = new Map();
  for (const race of races ?? []) {
    if (!venues.has(race.venueCode))
      venues.set(race.venueCode, { placeCd: race.venueCode, races: [] });
    venues
      .get(race.venueCode)
      .races.push({ ...race, entries: race.players ?? [] });
  }
  return [...venues.values()];
}

/**
 * トップの venuesData（get_today_races の形。レース番号は raceNo、会場コードは会場の placeCd）を
 * buildFavoritesFallback の入力（race.raceNumber・race.venueCode）にそろえる（BOA-1274）。
 * 代わりの表示は☆0人でも出すので、予測の応答は読まずにこの形から作る。
 */
export function venuesFromTodayRaces(venuesData) {
  return (venuesData ?? []).map((venue) => ({
    placeCd: venue.placeCd,
    races: (venue.races ?? []).map((race) => ({
      ...race,
      venueCode: venue.placeCd,
      raceNumber: race.raceNumber ?? race.raceNo,
    })),
  }));
}

/** ☆の選手1人×1レースの行を、締切順に分ける。入力は今日の出走表。 */
export function buildFavoriteRuns(venuesData, racerIds, nowHHMM) {
  const favorites = new Set(racerIds);
  const rows = [];
  for (const venue of venuesData) {
    for (const race of venue.races) {
      if (race.cancellationStatus) continue;
      for (const entry of race.entries) {
        if (!favorites.has(entry.racerId)) continue;
        rows.push({
          raceId: race.raceId,
          venueCode: race.venueCode,
          raceNumber: race.raceNumber,
          startTime: race.startTime,
          raceGrade: race.raceGrade,
          boat: entry.number,
          racerId: entry.racerId,
          name: entry.name,
          grade: entry.grade,
        });
      }
    }
  }
  rows.sort(compareRaces);
  const upcoming = [];
  const past = [];
  for (const row of rows) {
    (nowHHMM !== null && row.startTime <= nowHHMM ? past : upcoming).push(row);
  }
  return {
    upcoming,
    past,
    runningRacerCount: new Set(rows.map((row) => row.racerId)).size,
    raceCount: new Set(rows.map((row) => row.raceId)).size,
  };
}

/** aggregateRacerCrossStats の号艇別の行から成績の一言を作る。 */
export function statLineOf(boatRow) {
  if (!boatRow || !(boatRow.n > 0)) return { kind: "none" };
  const { n, top2Rate } = boatRow;
  if (n < 30) return { kind: "count", n };
  if (!Number.isFinite(top2Rate)) return { kind: "none" };
  // RacerPerformanceStats.jsx の枠番別2連率 → utils/formatters.js の
  // formatPercent と同じ (rate * 100).toFixed(1)。ここでは % を付けない。
  return { kind: "rate", n, ratePct: (top2Rate * 100).toFixed(1) };
}

/** ☆の会場は保存順、SG/G1 は先頭レースで判定（sgNowVenues.js と同じ）。 */
export function buildFavoritesFallback(venuesData, venueCodes, nowHHMM) {
  const venues = new Map(venuesData.map((venue) => [venue.placeCd, venue]));
  const favVenues = venueCodes.map((venueCode) => {
    const races = venues.get(venueCode)?.races ?? [];
    // null は時刻で分けない（useNowHHMM が無効のときと同じ）。
    const next = races
      .filter(
        (race) =>
          !race.cancellationStatus &&
          (nowHHMM === null || race.startTime > nowHHMM),
      )
      .sort(compareRaces)[0];
    return {
      venueCode,
      state: next ? "open" : races.length ? "finished" : "closed",
      nextRaceNumber: next?.raceNumber ?? null,
      nextStartTime: next?.startTime ?? null,
    };
  });
  const gradeVenues = venuesData
    .filter((venue) => ["SG", "G1"].includes(venue.races[0]?.raceGrade))
    .map((venue) => ({
      venueCode: venue.placeCd,
      grade: venue.races[0].raceGrade,
      seriesDay: venue.races[0].seriesDay,
      finalStartTime: (
        venue.races.find((race) => race.raceNumber === 12) ??
        venue.races[venue.races.length - 1]
      ).startTime,
    }))
    .sort(
      (a, b) =>
        (a.grade === "SG" ? 0 : 1) - (b.grade === "SG" ? 0 : 1) ||
        a.venueCode - b.venueCode,
    );
  return {
    favVenues,
    gradeVenues,
    openVenueCount: venuesData.filter((venue) => venue.races.length > 0).length,
  };
}
