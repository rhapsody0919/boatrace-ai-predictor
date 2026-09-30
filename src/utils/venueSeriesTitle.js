/**
 * 会場ページの title・description に入れる節タイトルを決める（集客レーン Phase3、2026-09-30）。
 *
 * 「{会場}競艇予想 ai」は SG 開催週に跳ねる（桐生SGの週に「桐生競艇予想 ai」が1週1,489表示）ため、
 * SG・G1 開催中だけ節タイトルを入れる。判定はトップの会場カードの SG/G1 バッジと同じ race_grade で、
 * 会場の代表値は先頭レースの値（VenueGridCard と同じ）。節タイトルは全角数字等を NFKC で揃える
 * （RaceDetailPage と同じ）。検証: scripts/maintenance/verify-venue-series-title.js
 */
const SERIES_TITLE_GRADES = new Set(["SG", "G1"]);

/**
 * @param {{raceGrade?: string|null, raceTitle?: string|null}[]} races - 会場の本日のレース（レース番号順）
 * @returns {string|null} SG・G1 開催中なら節タイトル、それ以外は null
 */
export function getVenueSeriesTitle(races) {
  const first = races?.[0];
  if (!first || !SERIES_TITLE_GRADES.has(first.raceGrade)) return null;
  const title = first.raceTitle?.normalize("NFKC").trim();
  return title ? title : null;
}
