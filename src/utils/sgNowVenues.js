/**
 * トップの「SG開催中」帯に出す会場を決める（集客レーン、2026-10-02）。
 *
 * 会場の代表値は先頭レースの値（トップの会場カードの SG/G1 バッジと同じ。VenueGridCard）。
 * 節タイトルは全角数字等を NFKC で揃える（RaceDetailPage・会場ページの title と同じ）。
 * 検証: scripts/maintenance/verify-sg-now-venues.js
 *
 * @param {{placeCd: number, races: {raceGrade?: string|null, raceTitle?: string|null}[]}[]} venuesData
 * @returns {{venueCode: number, seriesTitle: string|null}[]} 会場コード順
 */
export function getSgNowVenues(venuesData) {
  return (venuesData ?? [])
    .filter((v) => v?.races?.[0]?.raceGrade === "SG")
    .map((v) => {
      const title = v.races[0].raceTitle?.normalize("NFKC").trim();
      return { venueCode: v.placeCd, seriesTitle: title ? title : null };
    })
    .sort((a, b) => a.venueCode - b.venueCode);
}
