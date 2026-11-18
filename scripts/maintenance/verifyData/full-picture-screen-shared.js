/**
 * verify-full-picture-screen-shared.js の場面のデータ（出走履歴の入力・負けの決まり手の行・オリジナル展示の表）。verify ではない。
 */
export const result = (race_id, over = {}) => ({
  race_id,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  rank4: 4,
  rank5: 5,
  rank6: 6,
  race_status: null,
  winning_technique: "逃げ",
  payout_win: 150,
  payout_place_1: 110,
  payout_place_2: 130,
  actual_course_1: 1,
  actual_course_2: 3,
  actual_course_3: 2,
  actual_course_4: 4,
  actual_course_5: 5,
  actual_course_6: 6,
  ...over,
});
export const R = [
  "2026-10-02-01-01",
  "2026-10-01-01-01",
  "2026-10-03-02-01",
  "2026-10-04-02-01",
];
export const historyInput = {
  entries: [
    { race_id: R[0], boat_number: 2 },
    { race_id: R[1], boat_number: 1 },
    { race_id: R[2], boat_number: 3 },
    { race_id: R[3], boat_number: 1 },
  ],
  raceRows: [
    { race_id: R[0], venue_code: 1, race_grade: "ippan" },
    { race_id: R[1], venue_code: 1, race_grade: null },
    { race_id: R[2], venue_code: null },
    { race_id: R[3], venue_code: 2, race_grade: "G1" },
  ],
  // R[3] は不成立（race_status=no_race、使えない結果）
  resultRows: [
    result(R[0]),
    result(R[1], { rank1: 3, rank2: 2, rank3: 4 }),
    result(R[2]),
    result(R[3], { race_status: "no_race" }),
  ],
  exhibitionRows: [{ race_id: R[0], boat_number: 2, exhibition_time: 6.71 }],
  conditionRows: [
    {
      race_id: R[0],
      race_stage: "予選",
      race_title: "x杯",
      weather: "晴",
      wind_speed: 5,
      wave_height: 3,
    },
  ],
  stRows: [
    {
      race_id: R[0],
      boat_number: 1,
      start_timing: 0.1,
      is_flying: false,
      finish_mark: "1",
      entry_course: 1,
    },
    {
      race_id: R[0],
      boat_number: 2,
      start_timing: 0.15,
      is_flying: false,
      finish_mark: "2",
      entry_course: null,
    },
    {
      race_id: R[0],
      boat_number: 3,
      start_timing: 0.02,
      is_flying: true,
      finish_mark: "F",
      entry_course: 3,
    },
    {
      race_id: R[1],
      boat_number: 1,
      start_timing: null,
      is_flying: false,
      finish_mark: "転",
      entry_course: 1,
    },
  ],
};
export const LOSING_ROWS = [
  {
    venue_code: 1,
    boat_number: 1,
    losing_technique: "差し",
    count_90days: 30,
    total_losses_90days: 80,
    percentage: 37.5,
    last_updated: "2026-10-25",
  },
  {
    venue_code: 1,
    boat_number: 1,
    losing_technique: "まくり",
    count_90days: 20,
    total_losses_90days: 80,
    percentage: 25,
    last_updated: "2026-10-24",
  },
  // 別の会場の行は混ざらない
  {
    venue_code: 2,
    boat_number: 3,
    losing_technique: "逃げ",
    count_90days: 5,
    total_losses_90days: 200,
    percentage: 2.5,
    last_updated: "2026-10-24",
  },
];
// オリジナル展示の表（ox-1 が本命、ox-2 は別のレースの値）
export const ORIGINAL_EXHIBITION_TABLES = {
  race_original_exhibition: [
    {
      race_id: "ox-1",
      item_labels: " 直線 | 一周 ",
      updated_at: "2026-10-25T05:00:00Z",
    },
  ],
  race_original_exhibition_values: [
    { race_id: "ox-1", boat_number: 1, kind: "一周", value: "37.21" },
    { race_id: "ox-1", boat_number: 1, kind: "直線", value: 7.01 },
    { race_id: "ox-1", boat_number: 2, kind: "一周", value: null },
    { race_id: "ox-1", boat_number: 2, kind: "まわり足", value: "5.5" },
    { race_id: "ox-2", boat_number: 1, kind: "直線", value: "9" },
  ],
};
