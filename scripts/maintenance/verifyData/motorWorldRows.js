/**
 * motor-tab-readability.js・motor-window-generation.js が共に使う、会場15・24号機の偽の DB の行の作り方。verify ではない。
 */
export const V = 15;
export const M = 24;
export const race = (race_id) => ({
  race_id,
  race_date: race_id.slice(0, 10),
  venue_code: Number(race_id.slice(11, 13)),
});
// レースの艇（出走表）の行。列は本体が読む名前
export const ent = (race_id, boat_number, racer_id, extra = {}) => ({
  race_id,
  boat_number,
  racer_id,
  player_name: `選手${racer_id}`,
  grade: "A1",
  motor_number: M,
  global_2rate: 50,
  motor_2rate: 40,
  motor_3rate: 60,
  ...extra,
});
// order に並べた艇番が 1着, 2着, ...（rank1〜rank6）
export const resultOf = (race_id, order, extra = {}) => ({
  race_id,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [`rank${n}`, order[n - 1] ?? null]),
  ),
  race_status: null,
  ...extra,
});
export const startRows = (venue, ...dates) =>
  dates.map((start_date) => ({ venue_code: venue, start_date }));

/** 展示タイム・部品交換・プロペラ交換の記録（ID は g0・a・a2・b・c のレース ID） */
export const exhibitionRows = (ID) => [
  {
    race_id: ID.g0,
    boat_number: 1,
    exhibition_time: 6.8,
    propeller_change: false,
    parts_changed: null,
  },
  {
    race_id: ID.a,
    boat_number: 2,
    exhibition_time: 6.7,
    propeller_change: false,
    parts_changed: null,
  },
  {
    race_id: ID.a2,
    boat_number: 4,
    exhibition_time: 6.65,
    propeller_change: false,
    parts_changed: ["ピストン"],
  },
  {
    race_id: ID.b,
    boat_number: 3,
    exhibition_time: 6.6,
    propeller_change: false,
    parts_changed: null,
  },
  {
    race_id: ID.c,
    boat_number: 5,
    exhibition_time: null,
    propeller_change: true,
    parts_changed: null,
  },
];
