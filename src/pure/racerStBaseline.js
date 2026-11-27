/**
 * 選手ページの ST の推移に引く「今の級×同じ進入コースの全国平均」（オーナー 2026-11-27、ファン4人の議論の推奨）。
 * st_course_baseline（実進入コース×級の24行、F を除く全期間）から、選手が走った各走の進入コースの行を引き、
 * 絞り込みの範囲の走（本番 ST があり F でない走。カードの平均ST と同じ母数）で平均する。ST は進入コースで変わるので、
 * 級だけの平均でなくコースをそろえる。級はレース時点でなく今の級（選手ページの取得に走ごとの級が無い）。
 */

/**
 * @param {Array<{startTiming: number|null, isFlying: boolean, entryCourse: number|null}>} runs
 * @param {Array<{course: number, grade: string, avg_st: number|null, window_start?: string, window_end?: string}>} baselineRows
 * @param {string|null} grade 今の級（A1・A2・B1・B2）
 * @returns {{value: number, n: number, windowStart: string|null, windowEnd: string|null} | null}
 */
export function stCourseGradeAvg(runs, baselineRows, grade) {
  if (!grade || !Array.isArray(baselineRows)) return null;
  const rows = baselineRows.filter(
    (r) => r.grade === grade && r.avg_st != null,
  );
  const byCourse = new Map(
    rows.map((r) => [Number(r.course), Number(r.avg_st)]),
  );
  const values = runs
    .filter((r) => r.startTiming != null && !r.isFlying)
    .map((r) => byCourse.get(Number(r.entryCourse)))
    .filter((v) => v !== undefined);
  if (values.length === 0) return null;
  return {
    value: values.reduce((a, b) => a + b, 0) / values.length,
    n: values.length,
    windowStart: rows[0]?.window_start ?? null,
    windowEnd: rows[0]?.window_end ?? null,
  };
}
