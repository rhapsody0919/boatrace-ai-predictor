/**
 * レース結果のスタート隊形（BOA-811、承認モック docs/design/race-result-start-formation/mock）の行の並び。純関数。
 * 入力は supabaseDataService.getRaceStartTimings の行（boatNumber・startTiming・isFlying・isLateStart・
 * finishMark・entryCourse）。
 *
 * - 出走した艇は進入コースの順（上が1コース）。進入が1艇も分からないレースは null（絵を出さない）
 * - 欠場（着の印「欠」、または進入も ST も無く出遅れでもない艇）は一番下に並べる（行は消さない）
 * - 前付け: 出走した艇の中で、枠なりの順（艇番の小さい順）より内側のコースに入った艇。欠場で繰り上がっただけの艇は
 *   内側に入っていないので付けない（江戸川 2026-09-26 11R: 5号艇が欠場、6号艇が5コース）
 * - 最速: F を除いた ST が2艇以上あるときだけ、一番早い艇（結果の表の「最速」と同じ。BOA-586）
 * @param {Array<{boatNumber: number, startTiming: number|null, isFlying?: boolean, isLateStart?: boolean, finishMark?: string|null, entryCourse?: number|null}>|null} startTimings
 * @returns {null | Array<{course: number|null, boat: number, st: number|null, flying: boolean, late: boolean, absent: boolean, mae: boolean, fastest: boolean}>}
 */
export function startFormationRows(startTimings) {
  const all = startTimings ?? [];
  const isAbsent = (r) =>
    r.finishMark === "欠" ||
    (r.entryCourse == null && r.startTiming == null && !r.isLateStart);
  const racing = all
    .filter((r) => !isAbsent(r) && r.entryCourse != null)
    .sort((a, b) => a.entryCourse - b.entryCourse);
  if (racing.length === 0) return null;
  const absent = all
    .filter(isAbsent)
    .sort((a, b) => a.boatNumber - b.boatNumber);
  const byBoat = racing.map((r) => r.boatNumber).sort((a, b) => a - b);
  const timed = racing.filter((r) => r.startTiming != null && !r.isFlying);
  const fastest =
    timed.length >= 2 ? Math.min(...timed.map((r) => r.startTiming)) : null;
  return [
    ...racing.map((r) => ({
      course: r.entryCourse,
      boat: r.boatNumber,
      st: r.startTiming ?? null,
      flying: Boolean(r.isFlying),
      late: Boolean(r.isLateStart),
      absent: false,
      mae: r.entryCourse < byBoat.indexOf(r.boatNumber) + 1,
      fastest: fastest != null && !r.isFlying && r.startTiming === fastest,
    })),
    ...absent.map((r) => ({
      course: null,
      boat: r.boatNumber,
      st: null,
      flying: false,
      late: false,
      absent: true,
      mae: false,
      fastest: false,
    })),
  ];
}

/** ST の表示（結果の表と同じ形。フライングは公式と同じ「F.01」、BOA-583） */
export const formationStText = (st, flying) =>
  flying ? `F${st.toFixed(2).replace(/^0/, "")}` : st.toFixed(2);
