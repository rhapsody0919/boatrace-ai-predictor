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

/**
 * 区画の行の今節を切る目印（GS04-7）。その日のその会場の最後より後ろの race_id にして、
 * 行のレースが締切後でもそのレースの着を含める。同じ選手の行は、どの行でも同じ今節になる
 * （ファン評価 1周目: 締切後の行に、そのレースの着が出ていなかった）
 */
export const meetAnchorOf = (raceId) => `${raceId.slice(0, 13)}-99`;

/** 今節の走のうち結果が出たもの（着順・欠場・公式の記号のどれかがある）。まだ走っていない今日の走を「着外」と出さない */
export const finishedRuns = (runs) =>
  runs.filter((run) => run.finishRank != null || run.absent || run.finishMark);

/** 選手名の公式の全角空白（姓と名の間に U+3000 が続く）を1つの半角空白にする（結果タブと同じ見え方） */
export const displayRacerName = (name) =>
  typeof name === "string" ? name.replace(/[\s\u3000]+/g, " ").trim() : name;

/**
 * 成績の一言の主語に使う姓（オーナー 2026-11-04: 「今井の1号艇 出走数…」）。表示名の最初の語。
 * 姓と名の間に空白が無い名前は全体を返す
 */
export const racerSurname = (name) => {
  const shown = displayRacerName(name);
  return typeof shown === "string" ? shown.split(" ")[0] : shown;
};

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
      finalStartTime:
        venue.races.find((race) => race.raceNumber === 12)?.startTime ?? null,
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
