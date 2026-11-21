/**
 * 会場ページの「コース別成績と特徴（直近1年）」の表の行を組む（BOA-1687 GS02 V1）。
 * 値は要約2行と同じ静的な値（src/data/venueSummaryStats.js）。新しい DB の読みは足さない。
 *
 * - 行は進入コース（枠番ではない）1〜6 の6行
 * - 列は 1着率・全国の同コースの1着率・1着の回数（母数は courseRaces、表の上の期間の行に書く）
 * - 母数が0・会場の値が無いときは null（節ごと出さない）
 */

/** 節の id。要約2行の直下のページ内リンクの行き先 */
export const VENUE_COURSE_SECTION_ID = "venue-course-section";

/**
 * @param {{courseRaces: number, courses: {course: number, wins: number, rate: number}[]} | undefined} venue
 * @param {{courses: {course: number, rate: number}[]}} national
 * @returns {{course: number, rate: number, nationalRate: number | null, wins: number}[] | null}
 */
export function venueCourseTableRows(venue, national) {
  if (!venue || !(venue.courseRaces > 0)) return null;
  return [1, 2, 3, 4, 5, 6].map((course) => {
    const own = venue.courses.find((c) => c.course === course);
    const nat = national.courses.find((c) => c.course === course);
    return {
      course,
      rate: own?.rate ?? 0,
      nationalRate: nat?.rate ?? null,
      wins: own?.wins ?? 0,
    };
  });
}
