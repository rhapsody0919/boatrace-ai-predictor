/**
 * verify-race-motor-breakdown.js の入力と偽の DB の表。verify ではない。
 */
export const rows = [
  {
    boat_number: 1,
    player_name: "A",
    racer_id: 1001,
    motor_number: 11,
    motor_2rate: 40.5,
    motor_3rate: 60.1,
  },
  {
    boat_number: 2,
    player_name: "B",
    racer_id: 1002,
    motor_number: 12,
    motor_2rate: 0,
    motor_3rate: 0,
  },
  {
    boat_number: 3,
    player_name: "C",
    racer_id: 1003,
    motor_number: 13,
    motor_2rate: null,
    motor_3rate: null,
  },
  {
    boat_number: 4,
    player_name: "D",
    racer_id: 1004,
    motor_number: 14,
    motor_2rate: 33,
    motor_3rate: 50,
  },
];
// 艇3は取得失敗（fetchFailed）、艇4は結果なし（undefined）
export const statsAsOf = [
  { finalCount: 3, championshipCount: 1, firstPlaceCount: 5, raceCount: 40 },
  {
    finalCount: 0,
    championshipCount: 0,
    firstPlaceCount: 0,
    raceCount: 0,
    fetchFailed: false,
  },
  { fetchFailed: true },
  undefined,
];
export const pretest = new Map([
  [1001, { pretest_time: 6.75, pretest_rank: 2 }],
  [1003, { pretest_time: null, pretest_rank: null }],
]);
export const powerIndexes = [
  {
    sample_count: 30,
    actual_rate2: 45.2,
    actual_rate3: 62.0,
    power_index: 3.1,
    clipped_by_generation: true,
  },
  {
    sample_count: 0,
    actual_rate2: null,
    actual_rate3: null,
    power_index: null,
  },
  null,
  {
    sample_count: 12,
    actual_rate2: 0,
    actual_rate3: 0,
    power_index: -1.5,
    clipped_by_generation: false,
  },
];
export const freshOk = {
  columns: rows.map((_, i) => ({
    generation_runs: i,
    generation_rate2: null,
    generation_rate3: null,
    generation_power_index: null,
    prior_meet_runs: i === 0 ? 20 : null,
  })),
  freshness: { generationStart: "2026-08-06", firstMeet: false },
  failed: false,
};
export const freshFailed = { ...freshOk, failed: true };

export const addDays = (ymd, n) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const VENUE = 3;
const mkRace = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const resultRow = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
const statsRow = (motor_number, scraped_date, final_count) => ({
  venue_code: VENUE,
  motor_number,
  scraped_date,
  meet_count: 5,
  race_count: 40,
  final_count,
  championship_count: 1,
  first_place_count: 6,
});

export const entriesOf = (raceId) => [
  {
    race_id: raceId,
    boat_number: 1,
    player_name: "A",
    racer_id: 1001,
    motor_number: 11,
    motor_2rate: 0,
    motor_3rate: 0,
    global_2rate: 20,
  },
  {
    race_id: raceId,
    boat_number: 2,
    player_name: "B",
    racer_id: 1002,
    motor_number: 12,
    motor_2rate: 40,
    motor_3rate: 60,
    global_2rate: 20,
  },
  {
    race_id: raceId,
    boat_number: 3,
    player_name: "C",
    racer_id: 1003,
    motor_number: 13,
    motor_2rate: 33,
    motor_3rate: 50,
    global_2rate: 20,
  },
];
export const breakdownTables = (raceId, { generationStart }) => {
  const today = raceId.slice(0, 10);
  const far = addDays(today, -45); // 90日の中・30日の外
  const near = addDays(today, -3);
  const earlier = [`${far}-03-01`, `${near}-03-02`];
  return {
    venue_motor_start_dates: [
      { venue_code: VENUE, start_date: generationStart },
    ],
    races: [...earlier, raceId].map(mkRace),
    race_entries: [
      ...entriesOf(raceId),
      {
        race_id: earlier[0],
        boat_number: 1,
        global_2rate: 20,
        motor_number: 12,
        motor_2rate: 40,
      },
      {
        race_id: earlier[1],
        boat_number: 2,
        global_2rate: 20,
        motor_number: 12,
        motor_2rate: 40,
      },
    ],
    race_results: [
      resultRow(earlier[0], 3, 4, 5),
      resultRow(earlier[1], 2, 1, 4),
    ],
    race_conditions: [
      { race_id: `${today}-03-01`, series_day: 1, is_final_day: false },
    ],
    // 公式サイトの成績の取得履歴（レース日以前で最新を使う）
    venue_motor_stats: [
      statsRow(12, addDays(today, -2), 3),
      statsRow(12, addDays(today, -9), 1),
      statsRow(12, addDays(today, 1), 9),
    ],
    motor_pretest_stats: [
      {
        venue_code: VENUE,
        racer_id: 1002,
        race_date: addDays(today, -2),
        pretest_time: 6.75,
        pretest_rank: 2,
      },
      {
        venue_code: 4,
        racer_id: 1001,
        race_date: addDays(today, -2),
        pretest_time: 6.9,
        pretest_rank: 1,
      },
    ],
  };
};
