/**
 * アナロジー・ファインダー v16 の展示後の段の「今日の展示の値」（today-exhibition。BOA-271 T4-2）。
 * 純粋関数だけ（analogyV16Exhibition.js が再 export する）。
 */
import {
  entryType,
  exhibitionForms,
  signedSt,
  windBand,
} from "../../src/utils/analogyScenario.js";

export const BOATS = [1, 2, 3, 4, 5, 6];

const nanToNull = (v) => (Number.isNaN(v) ? null : v);

/** 艇ごとの展示の進入コース（無ければ null） */
function exhibitionCourses(byBoat) {
  return BOATS.map((b) => {
    const c = byBoat.get(b)?.exhibition_course;
    return c === null || c === undefined ? null : Number(c);
  });
}

/** コースごとの展示 ST（F は負。コースか ST が無い艇は入れない） */
function exhibitionStByCourse(byBoat, course) {
  const stByCourse = [null, null, null, null, null, null];
  BOATS.forEach((b, i) => {
    const r = byBoat.get(b);
    const st = r?.start_timing;
    if (course[i] && st !== null && st !== undefined)
      stByCourse[course[i] - 1] = signedSt(Number(st), r.start_flag === "F");
  });
  return stByCourse;
}

/** today-exhibition の気象の値（live[0] の値。NaN は null） */
function liveWeather(live) {
  const first = live[0];
  return {
    weather_code: nanToNull(first?.weather_code) ?? null,
    wind_x: nanToNull(first?.wind_x) ?? null,
    wind_y: nanToNull(first?.wind_y) ?? null,
  };
}

/**
 * 今日の展示の値（today-exhibition。T4-2）: 展示タイムと順位、風速区分、展示の進入の型、展示 ST（F は負）と
 * 展示の形（F.05 までは .00 として判定、F.06 以上か出遅れの艇がいれば判定しない。Q-F6）
 * @param {object[]} exhRows exhibition_data の6行
 * @param {object} live buildLiveFeatures の6艇
 * @param {object} cond race_conditions の行
 */
export function todayExhibition(exhRows, live, cond) {
  const byBoat = new Map(exhRows.map((r) => [Number(r.boat_number), r]));
  const course = exhibitionCourses(byBoat);
  const stByCourse = exhibitionStByCourse(byBoat, course);
  const hasLate = BOATS.some((b) => byBoat.get(b)?.start_flag === "L");
  const { forms, excluded } = exhibitionForms(stByCourse, hasLate);
  return {
    exh_time: live.map((v) => nanToNull(v.exh_time)),
    exh_time_rank: live.map((v) => nanToNull(v.exh_time_rank)),
    exh_time_diff: live.map((v) => nanToNull(v.exh_time_diff)),
    ...liveWeather(live),
    wind_speed: cond?.wind_speed ?? null,
    wave_height: cond?.wave_height ?? null,
    wind_band: windBand(cond?.wind_speed ?? null),
    course_by_boat: course,
    entry_type: entryType(course),
    st_by_course: stByCourse,
    forms,
    // F.06 以上か出遅れの艇がいるので展示の形を判定しなかった（Q-F6）
    forms_excluded: excluded,
  };
}
