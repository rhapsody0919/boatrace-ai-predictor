/**
 * 予想バッチが保存する racerStats（predictions.feature_contributions.racerStats）を、
 * 画面で使う形に詰め替える（BOA-302）。
 *
 * 保存側のキーは `course`（generate-predictions.js の racer.lane ＝ 枠番）と
 * `courseRaceCounts`（racer_aggregated_stats.course_race_counts。旧列 course_1〜6 由来で常に艇番）。
 * どちらも中身は枠番で、実進入コースではない。BOA-284 で「実進入コースに直しても予測力は
 * 上がらない」と検証され、枠番キーのまま維持すると決まっている
 * （docs/design/course-entry-tendency-rework/spec.md）。
 * 画面側が「コース」と読み違えないよう、境界で `wakuRaceCounts` に名前を変え、
 * `course`（boatNumber と同じ値）は渡さない。保存済み JSON・バッチ・モデル入力は変えない。
 *
 * @param {Array<object>|null|undefined} racerStats - 保存されたままの配列
 * @returns {Array<{boatNumber: number, avgST: number|null, attackDistribution: object|null,
 *   defenseDistribution: object|null, wakuRaceCounts: object|null}>|null}
 */
export function toWakuRacerStats(racerStats) {
  if (!Array.isArray(racerStats)) return null;
  return racerStats.map((s) => ({
    boatNumber: s.boatNumber,
    avgST: s.avgST ?? null,
    attackDistribution: s.attackDistribution ?? null,
    defenseDistribution: s.defenseDistribution ?? null,
    wakuRaceCounts: s.courseRaceCounts ?? null,
  }));
}
