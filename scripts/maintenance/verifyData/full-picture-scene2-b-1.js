/**
 * verify-full-picture-scene2.js の後半の場面（1/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let m;
let VENUES24, otherVenues;
export let entryRows, techAll, date, racerTables, COURSE_DEFAULT_DISTRIBUTION;

// 今節の走は facts の racers.boats[].meet_runs（固定の材料は racers を写していないので足す）。1号艇は2走（2走目は結果の行が無い）、3号艇は racers に無い
// 進入の分布は facts の racers.boats[].course_entry（racer_aggregated_stats）。1号艇は全国と会場の分、2号艇は行が無い、
// 4号艇は集計がこのレース以後の出走を含む（after_race）、5号艇はこの枠の進入が無い
const courseEntry = {
  1: {
    since: "2025-10-11",
    calculated_at: "2026-10-11T14:23:07+00:00",
    all: { 1: { n: 36, courses: { 1: 35, 2: 1 } } },
    venue: { 1: { n: 3, courses: { 1: 3 } } },
  },
  5: {
    since: "2025-10-11",
    calculated_at: "2026-10-11T14:23:07+00:00",
    all: { 1: { n: 2, courses: { 1: 2 } } },
    venue: null,
  },
};

export const startRows = [
  {
    race_id: "2026-10-10-01-05",
    boat_number: 4,
    finish_mark: "1",
    finish_rank: 1,
  },
  {
    race_id: "2026-10-11-01-03",
    boat_number: 2,
    finish_mark: "F",
    finish_rank: null,
  },
];

export const technique = {
  venue_technique_period_stats: [
    {
      period_days: 90,
      winning_technique: "逃げ",
      race_count: 388,
      total_races: 660,
      period_from: "2026-07-27",
      period_to: "2026-10-24",
      last_updated: "2026-10-25",
    },
  ],
  // 1号艇の抜きは percentage の小さい行を先に置く（画面と同じく percentage の降順で主な決まり手を選ぶか）
  winning_technique_stats: [
    {
      boat_number: 1,
      winning_technique: "抜き",
      count_90days: 27,
      total_races: 412,
      percentage: 6.55,
      last_updated: "2026-10-25",
    },
    {
      boat_number: 1,
      winning_technique: "逃げ",
      count_90days: 385,
      total_races: 412,
      percentage: 93.45,
      last_updated: "2026-10-25",
    },
  ],
};

const tech = (racer_id, course, over = {}) => ({
  racer_id,
  course,
  window_start: "2025-12-02",
  window_end: "2026-10-11",
  window_days: 314,
  runs: 25,
  nige_count: course === 1 ? 10 : null,
  nige_rate: course === 1 ? 40 : null,
  nige_expected: 54.48,
  makuri_count: 2,
  makuri_rate: 8,
  makuri_expected: 0,
  nigashi_count: course === 1 ? null : 12,
  nigashi_rate: course === 1 ? null : 48,
  nigashi_expected: 50,
  runs_90d: 6,
  nige_rate_90d: course === 1 ? 50 : null,
  makuri_rate_90d: 0,
  nigashi_rate_90d: course === 1 ? null : 50,
  last_updated: "2026-10-12",
  ...over,
});

const cN = (c, v) =>
  Object.fromEntries(
    [
      "entries",
      "avg_st",
      "avg_start_rank",
      "f",
      "l0",
      "l1",
      "p1",
      "p2",
      "p3",
    ].map((f, i) => [
      `c${c}_${f}`,
      f === "avg_st" ? 0.15 + v / 100 : f === "avg_start_rank" ? 2.5 : v + i,
    ]),
  );

const period = (racer_id, period_year, period_no, calc_to, v) => ({
  racer_id,
  period_year,
  period_no,
  calc_to,
  ...[1, 2, 3, 4, 5, 6].reduce(
    (o, c) => ({ ...o, ...cN(c, v * 10 + c) }),
    {},
  ),
});

const vRow = (race_grade, course, over = {}) => ({
  venue_code: m.venueCode,
  race_grade,
  course,
  runs: 136,
  nige_rate: course === 1 ? 62.2 : null,
  makuri_rate: course === 1 ? 0 : 5.1,
  nigashi_rate: course === 1 ? null : 62.2,
  window_start: "2025-12-02",
  window_end: "2026-10-11",
  last_updated: "2026-10-12",
  ...over,
});

// 書き換わる let（baseline・failRacer・predictionRows・failConditions・failExhibition・accidentRows・origHeader・origValues・kbReadable・failFinals・pooledN）は live に置く（塊を関数に割っても、閉じた関数が同じ値を見る）
export const live = {};

function scene1() {
  m.api.facts.racers = {
    meet_start: "2026-10-10",
    boats: [1, 2, 4, 5, 6].map((n) => ({
      boat_number: n,
      course_entry: courseEntry[n] ?? null,
      after_race: n === 4,
      meet_runs:
        n === 1
          ? [
              { race_id: "2026-10-11-01-03", boat_number: 2 },
              { race_id: "2026-10-10-01-05", boat_number: 4 },
              { race_id: "2026-10-12-01-02", boat_number: 1 },
            ]
          : [],
    })),
  };
  entryRows = [1, 2, 3, 4, 5].map((n) => ({
    boat_number: n,
    racer_id: 4000 + n,
    f_count: n === 1 ? 1 : n === 5 ? null : 0,
    grade: n === 2 ? "A1" : "B1",
  }));
  // 全国×枠（2026-10-26 hq 依頼、FT01）: 1着率は固定の材料の api.outcome（24会場）、決まり手は
  // winning_technique_stats の全会場の行（各会場 1号艇 逃げ10・抜き2、会場1だけ恵まれ1）
  VENUES24 = Array.from({ length: 24 }, (_, i) => i + 1);
  techAll = VENUES24.flatMap((venue_code) => [
    {
      venue_code,
      boat_number: 1,
      winning_technique: "逃げ",
      count_90days: 10,
      last_updated: "2026-10-11",
    },
    {
      venue_code,
      boat_number: 1,
      winning_technique: "抜き",
      count_90days: 2,
      last_updated: "2026-10-11",
    },
    ...(venue_code === 1
      ? [
          {
            venue_code,
            boat_number: 1,
            winning_technique: "恵まれ",
            count_90days: 1,
            last_updated: "2026-10-11",
          },
        ]
      : []),
  ]);
  // 選手のコース別の成績・会場のコース別の決まり手（2026-10-25 hq 依頼、FT01 優勝戦の思考の材料）。固定の材料の日は 2026-10-12
  date = m.raceId.slice(0, 10);
  racerTables = {
    // 1号艇 1コース（欠けなし）、2号艇 2コースは行が無い、3号艇は展示の進入 4コース（レースの日を含む集計）、4号艇 3コース、5号艇は枠番の5コース
    racer_course_technique_stats: [
      tech(4001, 1),
      tech(4001, 2),
      tech(4003, 3),
      tech(4003, 4, { window_end: date }),
      tech(4004, 3),
      tech(4005, 5),
    ],
    // 1号艇は締めた期（2026-04-30）とレースの日より後に締めた期（2026-10-31）。後者は使わない。2号艇は期が無い
    racer_period_stats: [
      period(4001, 2026, 1, "2026-04-30", 1),
      period(4001, 2026, 2, "2026-10-31", 9),
      period(4001, 2025, 2, "2025-10-31", 2),
      period(4003, 2026, 1, "2026-04-30", 3),
      period(4004, 2026, 1, "2026-04-30", 4),
      period(4005, 2026, 1, "2026-04-30", 5),
    ],
  };
  // G1 は6コースが欠け、ALL は6コースそろう
  // 全国×コース: 他の23会場の ALL（runs 1000・逃げ50%・まくり10.1%・逃がし50%）と、会場2の G1 の6コース（runs 50・まくり4%・逃がし52%）
  otherVenues = [
    ...[1, 2, 3, 4, 5, 6].flatMap((c) =>
      VENUES24.filter((v) => v !== m.venueCode).map((v) =>
        vRow("ALL", c, {
          venue_code: v,
          runs: 1000,
          nige_rate: c === 1 ? 50 : null,
          makuri_rate: 10.1,
          nigashi_rate: c === 1 ? null : 50,
        }),
      ),
    ),
    vRow("G1", 6, {
      venue_code: 2,
      runs: 50,
      makuri_rate: 4,
      nigashi_rate: 52,
    }),
  ];
}

async function scene2() {
  live.baseline = [
    ...[1, 2, 3, 4, 5].map((c) => vRow("G1", c)),
    ...[1, 2, 3, 4, 5, 6].map((c) => vRow("ALL", c, { runs: 2103 })),
    ...otherVenues,
  ];
  // 超展開データの元（予想 standard の racerStats、保存されたままの形）。2026-10-25 hq 依頼（FT01）
  // 1号艇: 勝ち10で選手の値 / 2号艇: 全枠の勝ちが4で参考 / 3号艇: 勝ちが1で全国平均の% / 4号艇: 決まり手の内訳が全国の既定 /
  // 5号艇: 勝ちは5号艇2・1号艇3の計5 / 6号艇: racerStats に無い
  ({ COURSE_DEFAULT_DISTRIBUTION } = await import("../../lib/winningTechniques.js"));
}

/** verify から呼ぶ入口。env は verify 側の束縛（m） */
export async function runFullPictureScene2B1(env) {
  ({ m } = env);
  scene1();
  await scene2();
}
