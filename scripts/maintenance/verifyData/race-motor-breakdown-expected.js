/**
 * verify-race-motor-breakdown.js の期待値（移す前の実装の出力）。verify ではない。
 * 行は「列の名前の並び」＋「行ごとの値」の表で持つ（キーの順も旧の実装のとおり）。
 */
const KEYS = [
  "boat_number",
  "player_name",
  "racer_id",
  "motor_number",
  "motor_2rate",
  "motor_3rate",
  "rate_source",
  "official_2rate",
  "official_3rate",
  "pretest_time",
  "pretest_rank",
  "power_index",
  "clipped_by_generation",
  "final_count",
  "championship_count",
  "first_place_count",
  "race_count",
  "venue_stats_failed",
];
const RECALC_KEYS = [
  "boat_number",
  "player_name",
  "racer_id",
  "motor_number",
  "motor_2rate",
  "motor_3rate",
  "rate_source",
  "sample_count",
  "official_3rate",
  "clipped_by_generation",
  "official_2rate",
  "pretest_time",
  "pretest_rank",
  "power_index",
  "final_count",
  "championship_count",
  "first_place_count",
  "race_count",
  "venue_stats_failed",
];
const SETTLED_KEYS = [
  ...KEYS,
  "generation_runs",
  "generation_rate2",
  "generation_rate3",
  "generation_power_index",
  "prior_meet_runs",
];
const rowsOf = (keys, table) =>
  table.map((values) => Object.fromEntries(keys.map((k, i) => [k, values[i]])));
const freshness = { generationStart: "2026-08-06", firstMeet: false };

// 艇3は取得失敗（venue_stats_failed）、艇4は結果なし。列は boat_number / player_name / racer_id / motor_number / motor_2rate / motor_3rate / rate_source / official_2rate / official_3rate / pretest_time / pretest_rank / power_index / clipped_by_generation / final_count / championship_count / first_place_count / race_count / venue_stats_failed
// prettier-ignore
const PAST = [
  [1, "A", 1001, 11, 40.5, 60.1, "official", 40.5, 60.1, 6.75, 2, null, false, 3, 1, 5, 40, false],
  [2, "B", 1002, 12, 0, 0, "official", 0, 0, null, null, null, false, 0, 0, 0, 0, false],
  [3, "C", 1003, 13, null, null, "official", null, null, null, null, null, false, null, null, null, null, true],
  [4, "D", 1004, 14, 33, 50, "official", 33, 50, null, null, null, false, null, null, null, null, false],
];
// 列は RECALC_KEYS
// prettier-ignore
const RECALC = [
  [1, "A", 1001, 11, 45.2, 62, "recalc", 30, 60.1, true, 40.5, 6.75, 2, 3.1, 3, 1, 5, 40, false],
  [2, "B", 1002, 12, 0, 0, "recalc", 0, 0, false, 0, null, null, null, 0, 0, 0, 0, false],
  [3, "C", 1003, 13, null, null, "recalc", null, null, false, null, null, null, null, null, null, null, null, true],
  [4, "D", 1004, 14, 0, 0, "recalc", 12, 50, false, 33, null, null, -1.5, null, null, null, null, false],
];
// 列は上の列に generation_runs / generation_rate2 / generation_rate3 / generation_power_index / prior_meet_runs を足した並び
// prettier-ignore
const SETTLE_FAILED = [
  [1, "A", 1001, 11, 40.5, 60.1, "official", 40.5, 60.1, 6.75, 2, null, false, 3, 1, 5, 40, false, 0, null, null, null, 20],
  [2, "B", 1002, 12, 0, 0, "official", 0, 0, null, null, null, false, 0, 0, 0, 0, false, 1, null, null, null, null],
  [3, "C", 1003, 13, null, null, "official", null, null, null, null, null, false, null, null, null, null, true, 2, null, null, null, null],
  [4, "D", 1004, 14, 33, 50, "official", 33, 50, null, null, null, false, null, null, null, null, false, 3, null, null, null, null],
];
// prettier-ignore
const SETTLE_OK = [
  [1, "A", 1001, 11, 40.5, 60.1, "official", 40.5, 60.1, 6.75, 2, null, false, 3, 1, 5, 40, false, 0, null, null, null, 20],
  [2, "B", 1002, 12, 0, 0, "official", 0, 0, null, null, null, false, 0, 0, 0, 0, false, 1, null, null, null, null],
  [3, "C", 1003, 13, null, null, "official", null, null, null, null, null, false, null, null, null, null, false, 2, null, null, null, null],
  [4, "D", 1004, 14, 33, 50, "official", 33, 50, null, null, null, false, null, null, null, null, false, 3, null, null, null, null],
];
// prettier-ignore
const SETTLE_FRESH_FAILED = [
  [1, "A", 1001, 11, 40.5, 60.1, "official", 40.5, 60.1, 6.75, 2, null, false, 3, 1, 5, 40, false, 0, null, null, null, 20],
  [2, "B", 1002, 12, 0, 0, "official", 0, 0, null, null, null, false, 0, 0, 0, 0, false, 1, null, null, null, null],
  [3, "C", 1003, 13, null, null, "official", null, null, null, null, null, false, null, null, null, null, false, 2, null, null, null, null],
  [4, "D", 1004, 14, 33, 50, "official", 33, 50, null, null, null, false, null, null, null, null, false, 3, null, null, null, null],
];

export const EXPECTED = {
  past: rowsOf(KEYS, PAST),
  recalc: rowsOf(RECALC_KEYS, RECALC),
  settleStatsFailed: {
    rows: rowsOf(SETTLED_KEYS, SETTLE_FAILED),
    freshness,
    fetchFailed: true,
  },
  settleOk: { rows: rowsOf(SETTLED_KEYS, SETTLE_OK), freshness },
  settleFreshFailed: {
    rows: rowsOf(SETTLED_KEYS, SETTLE_FRESH_FAILED),
    freshness,
    fetchFailed: true,
  },
};
