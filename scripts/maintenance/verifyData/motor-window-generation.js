/**
 * verify-motor-window-generation.js の場面のデータ（偽の DB の表）。verify ではない。
 * day(n) は今日から n 日後の日付、rid(n, no) はそのレース ID。期待値は verify 側に置く。
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

/** 使用開始日は今日の40日前。90日の窓は使用開始日で切り詰められ、30日の窓は切られない */
export const makeWorld = (day, rid) => {
  const G = day(-40);
  const ID = {
    pre: rid(-50, 1), // 使用開始日の前（入れ替え前の別モーター）
    g0: rid(-40, 1), // 使用開始日の当日
    g1: rid(-39, 2),
    g1b: rid(-39, 3), // 不成立（no_race）。艇6は着順なし
    a: rid(-20, 1),
    a2: rid(-20, 5), // a と同じ日。部品交換が記録される
    b: rid(-5, 1),
    c: rid(-3, 1), // 結果がまだ無い（未確定）。プロペラ交換が記録される
    other: rid(-20, 1, 16), // 他の会場
  };
  const world = () => ({
    venue_motor_start_dates: [
      ...startRows(V, G, day(-300)),
      ...startRows(16, day(-1)), // 他会場の行（会場で絞らないと世代が変わる）
    ],
    races: Object.values(ID).map(race),
    race_entries: [
      ent(ID.pre, 1, 11, {
        global_2rate: 50,
        motor_2rate: 70,
        motor_3rate: 80,
      }),
      ent(ID.g0, 1, 11, { global_2rate: 50, motor_2rate: 40, motor_3rate: 60 }),
      ent(ID.g1, 3, 11, { global_2rate: 50, motor_2rate: 41, motor_3rate: 61 }),
      ent(ID.g1b, 6, 11, {
        global_2rate: null,
        motor_2rate: 41,
        motor_3rate: 61,
      }),
      ent(ID.a, 2, 12, { global_2rate: 60, motor_2rate: 42, motor_3rate: 62 }),
      ent(ID.a, 1, 77, { motor_number: 25, global_2rate: 80 }), // 別のモーター番号
      ent(ID.a2, 4, 12, { global_2rate: 60, motor_2rate: 42, motor_3rate: 62 }),
      ent(ID.b, 3, 13, { global_2rate: 40, motor_2rate: 44, motor_3rate: 64 }),
      ent(ID.c, 5, 13, { global_2rate: 40, motor_2rate: 44, motor_3rate: 64 }),
      ent(ID.other, 1, 99, { global_2rate: 50 }),
    ],
    race_results: [
      resultOf(ID.pre, [1, 2, 3, 4, 5, 6]),
      resultOf(ID.g0, [1, 2, 3, 4, 5, 6]), // 艇1が1着
      resultOf(ID.g1, [4, 2, 1, 5, 6]), // 艇3が着順なし（失格等）。結果は成立している
      resultOf(ID.g1b, [1, 2, 3, 4, 5], { race_status: "no_race" }), // 不成立
      resultOf(ID.a, [1, 3, 4, 5, 6, 2]), // 艇2が6着
      resultOf(ID.a2, [2, 4, 1, 3, 5, 6]), // 艇4が2着
      resultOf(ID.b, [1, 2, 3, 4, 5, 6]), // 艇3が3着
      resultOf(ID.other, [1, 2, 3, 4, 5, 6]),
    ],
    exhibition_data: [
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
    ],
  });
  const noStart = () => ({
    ...world(),
    venue_motor_start_dates: startRows(16, day(-1)),
  });

  return { G, ID, world, noStart };
};

// 公式サイトの成績の取得履歴
const motorStats = (day) => [
  {
    venue_code: V,
    motor_number: M,
    scraped_date: day(-30),
    final_count: 3,
    championship_count: 1,
    first_place_count: 10,
    race_count: 50,
  },
  {
    venue_code: V,
    motor_number: M,
    scraped_date: day(-10),
    final_count: 5,
    championship_count: 2,
    first_place_count: 14,
    race_count: 70,
  },
  {
    venue_code: V,
    motor_number: 25,
    scraped_date: day(-10),
    final_count: 7,
    championship_count: 0,
    first_place_count: 2,
    race_count: 20,
  },
  {
    venue_code: V,
    motor_number: 26,
    scraped_date: day(-10),
    final_count: 1,
    championship_count: 0,
    first_place_count: 2,
    race_count: 20,
  },
  {
    venue_code: 16,
    motor_number: M,
    scraped_date: day(-30),
    final_count: 99,
    championship_count: 99,
    first_place_count: 99,
    race_count: 99,
  },
];

/** 使用開始日が1年以上前（入れ替え直後の特例が働かない）の会場。公式の2連率は全艇 0 より大きい */
export const makeBreakdownWorld = (day, rid) => () => {
  const tt = rid(0, 3); // 表示する当日のレース
  return {
    tt,
    tables: {
      venue_motor_start_dates: startRows(V, day(-400)),
      races: [rid(-20, 1), rid(-5, 1), rid(0, 2), tt, rid(0, 5)].map(race),
      race_entries: [
        // 過去レース（-20日）の出走表。艇1は別のモーター番号（スナップショットが無い）
        ent(rid(-20, 1), 1, 77, {
          motor_number: 25,
          motor_2rate: 30,
          motor_3rate: 50,
          global_2rate: 80,
        }),
        ent(rid(-20, 1), 2, 12, {
          motor_2rate: 42,
          motor_3rate: 62,
          global_2rate: 60,
        }),
        ent(rid(-5, 1), 3, 13, {
          motor_2rate: 44,
          motor_3rate: 64,
          global_2rate: 40,
        }),
        ent(rid(0, 2), 1, 11, {
          motor_2rate: 41,
          motor_3rate: 61,
          global_2rate: 50,
        }),
        // 表示する当日のレース
        ent(tt, 1, 11, {
          motor_2rate: 41.2,
          motor_3rate: 61.5,
          global_2rate: 50,
        }),
        ent(tt, 2, 12, {
          motor_number: 26,
          motor_2rate: 30,
          motor_3rate: 50,
          global_2rate: 60,
        }),
        // 同じ日の後のレース（直前までに入れない）
        ent(rid(0, 5), 1, 11, {
          motor_2rate: 41,
          motor_3rate: 61,
          global_2rate: 50,
        }),
      ],
      race_results: [
        resultOf(rid(-20, 1), [1, 3, 4, 5, 6, 2]),
        resultOf(rid(-5, 1), [1, 2, 3, 4, 5, 6]),
        resultOf(rid(0, 2), [1, 2, 3, 4, 5, 6]),
        resultOf(rid(0, 5), [1, 2, 3, 4, 5, 6]),
      ],
      venue_motor_stats: motorStats(day),
      motor_pretest_stats: [],
    },
  };
};
