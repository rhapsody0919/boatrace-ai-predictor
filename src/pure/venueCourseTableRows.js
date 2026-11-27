/**
 * 会場ページの「コース別成績と特徴（直近1年）」の表の行を組む（BOA-1687 GS02 V1）。
 * 値は要約2行と同じ静的な値（src/data/venueSummaryStats.js）。新しい DB の読みは足さない。
 *
 * - 行は進入コース（枠番ではない）1〜6 の6行
 * - 列は 1着率・全国の同コースの1着率・1着の回数（母数は courseRaces、表の上の期間の行に書く）
 * - 母数が0・会場の値が無いときは null（節ごと出さない）
 * - dir: 全国との向き（意味づけ 2026-11-26）。言えるのは1コースだけ（docs/reference/venue-summary-stats.md「言える範囲」:
 *   1コースは全国との比較まで、2・3コースは大づかみ、4〜6コースは値だけ）。1コースは静的な値の vsNational.course1
 *   （その会場を除く全国との z が Bonferroni 24会場の |z|>3.08 を超えたときだけ）、ほかは null
 */

/** 節の id。要約2行の直下のページ内リンクの行き先 */
export const VENUE_COURSE_SECTION_ID = "venue-course-section";

/**
 * @param {{courseRaces: number, courses: {course: number, wins: number, rate: number}[]} | undefined} venue
 * @param {{courses: {course: number, rate: number}[]}} national
 * @returns {{course: number, rate: number, nationalRate: number | null, wins: number, dir: "higher"|"lower"|null}[] | null}
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
      dir: course === 1 ? (venue.vsNational?.course1 ?? null) : null,
    };
  });
}
