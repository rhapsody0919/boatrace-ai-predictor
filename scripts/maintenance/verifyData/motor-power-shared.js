/**
 * verify-motor-power-shared.js の場面のデータ（会場3・モーター11 の走の表）。verify ではない。
 * 期待値は verify 側に置く。
 */
const race = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const ent = (race_id, boat_number, global_2rate, motor_number = 11) => ({
  race_id,
  boat_number,
  global_2rate,
  motor_number,
});
const res = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
export const emptyIndex = (venue, motor) => ({
  venue_code: venue,
  motor_number: motor,
  sample_count: 0,
  actual_rate2: null,
  actual_rate3: null,
  avg_baseline_rate2: null,
  power_index: null,
  generation_unknown: false,
  clipped_by_generation: false,
});

export const BEFORE = "2026-10-20-03-05";
export const mainTables = (startDates) => ({
  venue_motor_start_dates: startDates,
  races: [
    "2026-09-19-03-01", // 期間の外
    "2026-09-20-03-01", // 期間の端（30日前の日。含む）
    "2026-10-10-03-02",
    "2026-10-10-04-02", // 別の会場
    "2026-10-12-03-03",
    "2026-10-13-03-01",
    "2026-10-20-03-04", // このレースの直前
    BEFORE, // このレース自身（入らない）
    "2026-10-20-03-06", // このレースより後
    "2026-10-21-03-01", // 翌日
  ].map(race),
  race_entries: [
    ent("2026-09-19-03-01", 1, 99),
    ent("2026-09-20-03-01", 1, 50),
    ent("2026-10-10-03-02", 2, 30),
    ent("2026-10-10-03-02", 5, 70, 12), // 別のモーター
    ent("2026-10-10-04-02", 1, 10),
    ent("2026-10-12-03-03", 4, null), // 全国2連率なし（数えない）
    ent("2026-10-13-03-01", 6, 40), // 結果の行なし（数えない）
    ent("2026-10-20-03-04", 3, 20),
    ent(BEFORE, 1, 40),
    ent("2026-10-20-03-06", 1, 40),
    ent("2026-10-21-03-01", 1, 40),
  ],
  race_results: [
    res("2026-09-19-03-01", 1, 2, 3),
    res("2026-09-20-03-01", 1, 4, 6), // 艇1: 1着（2着以内）
    res("2026-10-10-03-02", 1, 3, 2), // 艇2: 3着（3着以内のみ）
    res("2026-10-10-04-02", 1, 2, 3),
    res("2026-10-12-03-03", 4, 1, 2),
    res("2026-10-20-03-04", 3, 1, 2), // 艇3: 1着
    res(BEFORE, 1, 2, 3),
    res("2026-10-20-03-06", 1, 2, 3),
    res("2026-10-21-03-01", 1, 2, 3),
  ],
});
