/**
 * 実進入コース（race_results.actual_course_1〜6、BOA-257）から選手の進入コース傾向を
 * 組み立てる純関数群（BOA-284）。aggregate-racer-stats.jsの4関数が共用する。
 *
 * actual_course_Nの添字は「艇番」で、値は「その艇が実際に進入したコース」
 * （scripts/lib/kfileParser.jsが boats.set(艇番, 進入コース) で作る）。
 * 旧列course_1〜6（添字=コース、値=艇番）とは逆向きなので、
 * 「値が艇番と一致する列を探す」旧来のループをそのまま流用してはならない。
 */
import {
  extractDateFromRaceId,
  extractVenueCodeFromRaceId,
} from "./dateUtils.js";

export const ACTUAL_COURSE_SELECT =
  "actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6";

/**
 * boatNumber艇が実際に進入したコース（1〜6）を返す。記録が無い（欠場等）場合はnull。
 */
export function actualCourseOf(result, boatNumber) {
  const course = result?.[`actual_course_${boatNumber}`];
  return Number.isInteger(course) && course >= 1 && course <= 6 ? course : null;
}

/**
 * boatNumber艇より内側の艇が欠場（進入コースの記録が無い）で、コースが繰り上がったか。
 * 例: 1号艇が欠場すると2号艇は1コースに入る。これは選手の意思による前づけ・枠なりではないため、
 * 進入傾向の集計から除外する（除外しないと江戸川のような枠なり固定の会場でも
 * 「枠外進入」が数件出て、進入傾向が汚れる）。
 */
export function isShiftedByAbsence(result, boatNumber) {
  for (let inner = 1; inner < boatNumber; inner += 1) {
    if (actualCourseOf(result, inner) === null) return true;
  }
  return false;
}

function tally(target, boatNumber, course) {
  const waku = String(boatNumber);
  if (!target[waku]) target[waku] = { n: 0, courses: {} };
  target[waku].n += 1;
  target[waku].courses[String(course)] =
    (target[waku].courses[String(course)] ?? 0) + 1;
}

/**
 * 選手の「枠番→実進入コース」の回数を、全体と会場別で集計する。
 * 走数の下限は適用しない（表示側が5走未満を「参考」として扱う）。
 * 実進入コースの記録が無い出走、および内側の艇の欠場でコースが繰り上がった出走は数えない。
 *
 * @param {Array<{race_id: string, boat_number: number}>} entries - 選手の出走
 * @param {Map<string, object>} resultsByRaceId - race_id -> actual_course_1〜6を含む結果
 * @param {string} since - YYYY-MM-DD。これより前のレースは集計しない
 * @returns {{since: string, all: object, venues: object}|null}
 *   all: { 枠番: { n, courses: { コース: 回数 } } }
 *   venues: { 会場コード: { 枠番: { n, courses } } }
 *   集計対象が1件も無ければnull
 */
export function buildCourseEntryTendency(entries, resultsByRaceId, since) {
  const all = {};
  const venues = {};
  let counted = 0;

  for (const entry of entries) {
    if (extractDateFromRaceId(entry.race_id) < since) continue;
    const result = resultsByRaceId.get(entry.race_id);
    const course = actualCourseOf(result, entry.boat_number);
    if (course === null) continue;
    if (isShiftedByAbsence(result, entry.boat_number)) continue;

    tally(all, entry.boat_number, course);
    const venueKey = String(extractVenueCodeFromRaceId(entry.race_id));
    if (!venues[venueKey]) venues[venueKey] = {};
    tally(venues[venueKey], entry.boat_number, course);
    counted += 1;
  }

  return counted > 0 ? { since, all, venues } : null;
}
