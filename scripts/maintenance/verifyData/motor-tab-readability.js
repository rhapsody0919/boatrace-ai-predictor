/**
 * verify-motor-tab-readability.js の場面のデータ（偽の DB の表）。verify ではない。
 * day(n) は今日から n 日後の日付、rid(n, no) はそのレース ID。期待値は verify 側に置く。
 */
import {
  M,
  V,
  ent,
  exhibitionRows,
  race,
  resultOf,
  startRows,
} from "./motorWorldRows.js";
export { M, V };
/** 部品交換・プロペラ交換の記録のある場面 */
export const partsScene = (day, rid) => {
  const G = day(-40);
  const ID = {
    g0: rid(-40, 1),
    a: rid(-20, 1),
    a2: rid(-20, 5),
    b: rid(-5, 1),
    c: rid(-3, 1),
  };
  const tables = () => ({
    venue_motor_start_dates: startRows(V, G),
    races: Object.values(ID).map(race),
    race_entries: [
      ent(ID.g0, 1, 11),
      ent(ID.a, 2, 12),
      ent(ID.a2, 4, 12),
      ent(ID.b, 3, 13),
      ent(ID.c, 5, 13),
    ],
    exhibition_data: exhibitionRows(ID),
  });
  return { G, tables };
};

/** 着順の付かない走・不成立・結果なしのある使用履歴の場面 */
export const usageTables = (day, rid) => {
  const G = day(-40);
  const g0 = rid(-40, 1); // 艇1が1着
  const g1 = rid(-39, 2); // 艇3が着順なし（失格等）。結果は成立している
  const g1b = rid(-39, 3); // 不成立（no_race）。艇6は着順なし
  const g2 = rid(-38, 1); // 結果がまだ無い（未確定）
  const g3 = rid(-38, 2); // 艇4が1着
  const tables = {
    venue_motor_start_dates: startRows(V, G),
    races: [g0, g1, g1b, g2, g3].map(race),
    race_entries: [
      ent(g0, 1, 11),
      ent(g1, 3, 11),
      ent(g1b, 6, 11),
      ent(g2, 2, 11),
      ent(g3, 4, 11),
    ],
    race_results: [
      resultOf(g0, [1, 2, 3, 4, 5, 6]),
      resultOf(g1, [4, 2, 1, 5, 6]),
      resultOf(g1b, [1, 2, 3, 4, 5], { race_status: "no_race" }),
      resultOf(g3, [4, 1, 2, 3, 5, 6]),
    ],
  };
  return tables;
};

/** 当日のレースの直前までを数える場面 */
export const todayScene = (day, rid) => {
  const tt = rid(0, 3); // 表示する当日のレース
  const before = rid(0, 2); // 同日の前のレース（入る）
  const after = rid(0, 5); // 同日の後のレース（入れない）
  const past = rid(-5, 1);
  const tables = {
    venue_motor_start_dates: startRows(V, day(-400)),
    races: [past, before, tt, after].map(race),
    race_entries: [
      ent(past, 3, 13, { global_2rate: 40 }),
      ent(before, 1, 11, { global_2rate: 50 }),
      ent(tt, 1, 11, {
        motor_2rate: 41.2,
        motor_3rate: 61.5,
        global_2rate: 50,
      }),
      ent(after, 1, 11, { global_2rate: 50 }),
    ],
    race_results: [
      resultOf(past, [1, 2, 3, 4, 5, 6]), // 艇3が3着: 2着以内でない
      resultOf(before, [1, 2, 3, 4, 5, 6]), // 艇1が1着
      resultOf(after, [1, 2, 3, 4, 5, 6]),
      resultOf(tt, [1, 2, 3, 4, 5, 6]),
    ],
    venue_motor_stats: [],
    motor_pretest_stats: [],
  };
  return { tt, tables };
};

/** 会場内順位の場面（同値・値なし・出走数 0） */
export const rankingTables = (day) => {
  const row = (motor_number, top2_rate, race_count = 10) => ({
    venue_code: V,
    motor_number,
    scraped_date: day(-10),
    top2_rate,
    win_rate: top2_rate,
    top3_rate: top2_rate,
    accident_rate: 0.1,
    final_count: 0,
    championship_count: 0,
    race_count,
    stats_period_end: null,
  });
  const tables = {
    venue_motor_stats: [
      row(24, 50),
      row(25, 60),
      row(26, 50),
      row(27, null),
      row(28, 99, 0),
      row(29, 40),
    ],
  };
  return tables;
};

/** 選手ページの今節のモーター（getRacerCurrentMotorStatus）の場面: 選手4500が2日前に2走（2R・9R）、前日に1走（4R） */
export const racerStatusScene = (day, rid) => {
  const ids = [rid(-2, 2), rid(-2, 9), rid(-1, 4)];
  const times = [6.81, 6.9, 6.7];
  const tables = {
    venue_motor_start_dates: startRows(V, day(-400)),
    races: ids.map(race),
    race_entries: ids.map((id, i) => ent(id, i + 1, 4500)),
    race_conditions: ids.map((race_id, i) => ({ race_id, series_day: i < 2 ? 1 : 2, is_final_day: false })),
    exhibition_data: ids.map((race_id, i) => ({
      race_id,
      boat_number: i + 1,
      exhibition_time: times[i],
      propeller_change: false,
      parts_changed: null,
    })),
  };
  return { racerId: 4500, tables };
};
