import assert from "node:assert/strict";
import { buildRacerScopedRaceRows } from "../../../src/services/racerScopedRaceRows.js";

/**
 * verify-racer-scoped-race-rows.js の場面のデータ（入力の行を作る関数・出力の行のキー・サービス層に載せる表）。verify ではない。
 */
export const R1 = "2026-10-01-04-01";
export const R9 = "2026-10-01-04-09";
export const R2 = "2026-10-02-04-03";

export const entry = (race_id, boat_number = 1, extra = {}) => ({
  race_id,
  boat_number,
  grade: "A1",
  f_count: 0,
  ...extra,
});
export const race = (race_id) => ({
  race_id,
  race_date: race_id.slice(0, 10),
  venue_code: race_id.slice(11, 13),
  race_grade: "一般",
});
export const result = (race_id, extra = {}) => ({
  race_id,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  rank4: 4,
  rank5: 5,
  rank6: 6,
  race_status: "normal",
  actual_course_1: 1,
  actual_course_2: 2,
  actual_course_3: 3,
  actual_course_4: 4,
  actual_course_5: 5,
  actual_course_6: 6,
  winning_technique: "逃げ",
  payout_win: 150,
  ...extra,
});
export const st = (race_id, boat_number, start_timing, extra = {}) => ({
  race_id,
  boat_number,
  start_timing,
  is_flying: false,
  finish_mark: null,
  entry_course: null,
  ...extra,
});
export const ex = (race_id, boat_number, exhibition_time) => ({
  race_id,
  boat_number,
  exhibition_time,
});
export const sixSt = (race_id, overrides = {}) =>
  [1, 2, 3, 4, 5, 6].map((b) =>
    st(race_id, b, 0.1 + b / 100, overrides[b] ?? {}),
  );

const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);
export const RACER = 6001;
export const S1 = `${addDays(today, -4)}-04-03`;
export const S2 = `${addDays(today, -3)}-04-01`;
export const SERVICE_TABLES = {
  race_entries: [
    entry(S1),
    entry(S2, 3, { grade: "B1", f_count: 1 }),
    { ...entry(S1, 2), racer_id: 6002 }, // 別の選手
  ].map((e) => ({ racer_id: RACER, ...e })),
  races: [race(S1), race(S2)],
  race_results: [result(S1), result(S2, { rank1: 3, rank2: 1, rank3: 2 })],
  race_start_timings: [
    ...sixSt(S1),
    ...sixSt(S2, { 3: { is_late_start: true, start_timing: 1.99 } }),
  ],
  exhibition_data: [ex(S1, 1, 6.7), ex(S1, 2, 6.8), ex(S2, 3, 6.9)],
  race_conditions: [
    {
      race_id: S1,
      race_stage: "予選",
      race_title: "A杯",
      wave_height: 3,
      series_day: 1,
      is_final_day: false,
    },
    {
      race_id: S2,
      race_stage: "優勝戦",
      race_title: "A杯",
      wave_height: 5,
      series_day: 2,
      is_final_day: true,
    },
  ],
};

// 出力の行のキー（BOA-1052 の表示用キーを追加、35個、順を含む）
export const ROW_KEYS = [
  "raceId",
  "date",
  "venueCode",
  "boatNumber",
  "raceGrade",
  "raceTitle",
  "raceStage",
  "waveHeight",
  "seriesDay",
  "isFinalDay",
  "rank1",
  "rank2",
  "rank3",
  "rank4",
  "rank5",
  "rank6",
  "winningTechnique",
  "payoutWin",
  "finishMark",
  "absent",
  "startTiming",
  "flyingStartTiming",
  "lateStartTiming",
  "actualCourse",
  "entryCourse",
  "grade",
  "exhibitionTime",
  "exhibitionRank",
  "fCount",
  "isFlying",
  "stForRank",
  "raceBestSt",
  "innerMinSt",
  "stRank",
  "isFastestExhibition",
];

/** 1レース・自艇1号艇の入力。over で配列ごと差し替える */
export const input = (over = {}) => ({
  entries: [entry(R1)],
  raceRows: [race(R1)],
  resultRows: [result(R1)],
  startTimingRows: sixSt(R1),
  exhibitionRows: [],
  conditionRows: [],
  ...over,
});
export const run = (over) => buildRacerScopedRaceRows(input(over));
export const only = (over) => {
  const rows = run(over);
  assert.equal(rows.length, 1);
  return rows[0];
};

let count = 0;
export const check = (name, fn) => {
  fn();
  count += 1;
  console.log(`  ok ${name}`);
};
export const checkAsync = async (name, fn) => {
  await fn();
  count += 1;
  console.log(`  ok ${name}`);
};
export const checked = () => count;

/** サービス層が取る表（SERVICE_TABLES）から buildRacerScopedRaceRows で組んだ期待の行。conditionRows は差し替えられる */
export const expectedServiceRows = (
  conditionRows = SERVICE_TABLES.race_conditions,
) =>
  buildRacerScopedRaceRows({
    entries: SERVICE_TABLES.race_entries
      .filter((e) => e.racer_id === RACER)
      .map(({ racer_id, ...e }) => e),
    raceRows: SERVICE_TABLES.races,
    resultRows: SERVICE_TABLES.race_results,
    startTimingRows: SERVICE_TABLES.race_start_timings,
    exhibitionRows: SERVICE_TABLES.exhibition_data,
    conditionRows,
  });
