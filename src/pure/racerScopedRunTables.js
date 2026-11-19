/**
 * RPC get_racer_scoped_race_rows（マイグレーション 203）の行を、6表の行の形へ戻す（純関数）。
 *
 * RPC は選手の走を「1走1行」で返す（同じレースの6艇ぶんの本番 ST・展示タイムは短い配列）。量を減らすための
 * 詰め方で、計算は入っていない。ここで元の6つの配列（race_entries・races・race_results・race_start_timings・
 * exhibition_data・race_conditions の行）へ戻し、整形は今までどおり buildRacerScopedRaceRows
 * （src/services/racerScopedRaceRows.js）の1か所で行う。
 *
 * 6表を直に読んだときとの違いは2つで、どちらも整形の結果を変えない:
 * - race_conditions の行が無いレースにも、値が全部 null の行を作る（整形は `condition?.x ?? null` で読む）
 * - 同じレースに同じ選手の走が2つあっても、レース単位の行（races・結果・ST・展示・条件）は1回だけ作る
 *   （6表の読みは race_id の in() で1回ずつ取る。2回作ると展示の順位が同じ艇を2度数える）
 *
 * scripts/maintenance/verify-racer-scoped-race-rpc.js が、同じ表からの2つの道の行が同じことを確かめる。
 */

const rankKeys = [1, 2, 3, 4, 5, 6].map((n) => `rank${n}`);
const courseKeys = [1, 2, 3, 4, 5, 6].map((n) => `actual_course_${n}`);

const entryOf = (run) => ({
  race_id: run.race_id,
  boat_number: run.boat_number,
  grade: run.grade,
  f_count: run.f_count,
});

const raceOf = (run) => ({
  race_id: run.race_id,
  race_date: run.race_date,
  venue_code: run.venue_code,
  race_grade: run.race_grade,
});

const resultOf = (run) => ({
  race_id: run.race_id,
  ...Object.fromEntries(rankKeys.map((key, i) => [key, run.ranks[i] ?? null])),
  race_status: run.race_status,
  ...Object.fromEntries(
    courseKeys.map((key, i) => [key, run.actual_courses?.[i] ?? null]),
  ),
  winning_technique: run.winning_technique,
  payout_win: run.payout_win,
});

const conditionOf = (run) => ({
  race_id: run.race_id,
  race_stage: run.race_stage,
  race_title: run.race_title,
  wave_height: run.wave_height,
  series_day: run.series_day,
  is_final_day: run.is_final_day,
});

const startTimingOf = (raceId, row) => ({
  race_id: raceId,
  boat_number: row[0],
  start_timing: row[1],
  is_flying: row[2],
  is_late_start: row[3],
  finish_mark: row[4],
  entry_course: row[5],
});

const exhibitionOf = (raceId, row) => ({
  race_id: raceId,
  boat_number: row[0],
  exhibition_time: row[1],
});

/**
 * @param {Array<object>} runs RPC の行（race_id・boat_number の順）
 * @returns {{ entries: Array<object>, raceRows: Array<object>, resultRows: Array<object>,
 *   startTimingRows: Array<object>, exhibitionRows: Array<object>, conditionRows: Array<object> }}
 *   buildRacerScopedRaceRows の入力
 */
export function tablesFromRacerScopedRuns(runs) {
  const races = [...new Map(runs.map((run) => [run.race_id, run])).values()];
  return {
    entries: runs.map(entryOf),
    // races の行が無い走（race_date は NOT NULL なので、null は行が無い）は作らない
    raceRows: races.filter((run) => run.race_date != null).map(raceOf),
    // 結果の行が無いレースは ranks が null
    resultRows: races.filter((run) => run.ranks != null).map(resultOf),
    startTimingRows: races.flatMap((run) =>
      (run.st_rows ?? []).map((row) => startTimingOf(run.race_id, row)),
    ),
    exhibitionRows: races.flatMap((run) =>
      (run.exhibition_rows ?? []).map((row) => exhibitionOf(run.race_id, row)),
    ),
    conditionRows: races.map(conditionOf),
  };
}
