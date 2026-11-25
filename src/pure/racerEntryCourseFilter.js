/**
 * 選手ページの成績の絞り込み「進入コース」（オーナー 2026-11-25）。
 * 出走履歴（getRacerRaceHistory の行）の entryCourse は実際に入ったコース（本番STの進入、無ければ Kファイル）。
 * 進入が分からない走（entryCourse が null）はどのコースにも数えない。履歴は 2025-12 以降だけ。
 */

export const ENTRY_COURSES = [1, 2, 3, 4, 5, 6];

/** 進入コースで絞った履歴。course が "all" ならそのまま返す */
export function filterByEntryCourse(history, course) {
  if (!history || course === "all") return history;
  const c = Number(course);
  return history.filter((row) => row.entryCourse === c);
}

/**
 * ほかの絞り込み（会場・枠番・グレード・レース種別。"all" は絞り込みなし）に合う走の、進入コースごとの数。
 * 選択肢に走数を出し、0走のコースを押せなくするのに使う。{ 1: n, …, 6: n }
 */
export function entryCourseCounts(history, { venue, boat, grade, stage }) {
  const counts = Object.fromEntries(ENTRY_COURSES.map((c) => [c, 0]));
  for (const row of history ?? []) {
    if (venue !== "all" && row.venueCode !== Number(venue)) continue;
    if (boat !== "all" && row.boatNumber !== Number(boat)) continue;
    if (grade !== "all" && row.raceGrade !== grade) continue;
    if (stage !== "all" && row.raceStage !== stage) continue;
    if (row.entryCourse in counts) counts[row.entryCourse] += 1;
  }
  return counts;
}
