/**
 * verify-motor-fresh-rate.js の場面のデータ（会場3・12号機の走・公式の出走表・材料の表）。verify ではない。
 * 期待値は verify 側に置く。
 */
export const VENUE = 3;
export const RACE = "2026-10-20-03-07";
const race = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const ent = (
  race_id,
  boat_number,
  global_2rate,
  motor_number,
  motor_2rate = 40,
) => ({
  race_id,
  boat_number,
  global_2rate,
  motor_number,
  motor_2rate,
});
const res = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
// 12号機の走（全国2連率 20）。このレースより前に4走、節の初日（10/18）より前に2走
const RUN_RACES = [
  "2026-10-10-03-01", // 艇2: 1着
  "2026-10-17-03-02", // 艇3: 着外
  "2026-10-18-03-03", // 艇1: 2着（節の初日）
  "2026-10-19-03-04", // 艇4: 3着
];
export const freshTables = (
  rows,
  { generationStart = "2026-10-06", official = [] } = {},
) => ({
  venue_motor_start_dates: [
    { venue_code: VENUE, start_date: generationStart },
    { venue_code: 4, start_date: "2026-10-19" },
  ],
  races: [...RUN_RACES, RACE, "2026-10-20-03-08"].map(race),
  race_entries: [
    ent(RUN_RACES[0], 2, 20, 12),
    ent(RUN_RACES[1], 3, 20, 12),
    ent(RUN_RACES[2], 1, 20, 12),
    ent(RUN_RACES[3], 4, 20, 12),
    ent(RACE, 5, 20, 12, 0), // このレース自身は数えない（公式0）
    ent("2026-10-20-03-08", 5, 20, 12, 0), // 後のレースも数えない（公式0）
    ...official, // その日その会場の出走表（公式の2連率）
  ],
  race_results: [
    res(RUN_RACES[0], 2, 4, 5),
    res(RUN_RACES[1], 1, 2, 4),
    res(RUN_RACES[2], 3, 1, 2),
    res(RUN_RACES[3], 1, 2, 4),
    res(RACE, 5, 1, 2),
    res("2026-10-20-03-08", 5, 1, 2),
  ],
  race_conditions: [
    { race_id: "2026-10-18-03-01", series_day: 1, is_final_day: false },
    { race_id: "2026-10-19-03-01", series_day: 2, is_final_day: false },
    { race_id: "2026-10-20-03-01", series_day: 3, is_final_day: false },
    { race_id: "2026-10-05-03-01", series_day: 1, is_final_day: true }, // 12日より前の節
  ],
});
export const NONE = {
  generation_runs: null,
  generation_rate2: null,
  generation_rate3: null,
  generation_power_index: null,
  prior_meet_runs: null,
};
// 12号機の、このレースより前の走（4走・艇2と艇1が2着以内・艇4が3着）の自前の値
export const OWN12 = {
  generation_runs: 4,
  generation_rate2: 50,
  generation_rate3: 75,
  generation_power_index: 30, // ((100-20)+(0-20)+(100-20)+(0-20))/4
};
export const rows3 = (r11, r12, r13) => [
  { motor_number: 11, motor_2rate: r11 },
  { motor_number: 12, motor_2rate: r12 },
  { motor_number: 13, motor_2rate: r13 },
];
export const OFFICIAL_ZERO_DAY = [
  ent("2026-10-20-03-01", 1, 20, 11, 0),
  ent("2026-10-20-03-02", 1, 20, 12, 0),
];
export const OFFICIAL_POSITIVE_DAY = [
  ent("2026-10-20-03-01", 1, 20, 11, 0),
  ent("2026-10-20-03-02", 1, 20, 12, 40),
];

export const breakdownTables = () => ({
  ...freshTables([], { official: OFFICIAL_POSITIVE_DAY }),
  race_entries: [
    ...freshTables([]).race_entries.filter((e) => e.race_id !== RACE),
    // 出走表（このレースの艇）。公式の2連率は 11号機 0・12号機 40
    {
      race_id: RACE,
      boat_number: 1,
      player_name: "A",
      racer_id: 1001,
      motor_number: 11,
      motor_2rate: 0,
      motor_3rate: 0,
      global_2rate: 20,
    },
    {
      race_id: RACE,
      boat_number: 2,
      player_name: "B",
      racer_id: 1002,
      motor_number: 12,
      motor_2rate: 40,
      motor_3rate: 60,
      global_2rate: 20,
    },
  ],
});

/** 入れ替えから90日を過ぎた世代の表 */
export const oldGenerationTables = () => ({
  ...freshTables([], { generationStart: "2026-01-01" }),
  races: [
    "2026-07-21-03-01", // 90日前（7/22）より前
    "2026-07-22-03-01", // 90日前の日（含む）
    "2026-10-19-03-04",
    RACE,
  ].map(race),
  race_entries: [
    ent("2026-07-21-03-01", 1, 20, 12),
    ent("2026-07-22-03-01", 1, 20, 12),
    ent("2026-10-19-03-04", 4, 20, 12),
  ],
  race_results: [
    res("2026-07-21-03-01", 1, 2, 3),
    res("2026-07-22-03-01", 1, 2, 3),
    res("2026-10-19-03-04", 1, 2, 4),
  ],
});
