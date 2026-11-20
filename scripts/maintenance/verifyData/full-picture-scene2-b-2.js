/**
 * verify-full-picture-scene2.js の後半の場面（2/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { COURSE_DEFAULT_DISTRIBUTION, live, date } from "./full-picture-scene2-b-1.js";

export let racerStatsRaw, scoped, scoped3;

export const stBaseline = [
  {
    course: 2,
    grade: "A1",
    window_start: "2025-12-02",
    window_end: "2026-10-11",
    runs: 12000,
    stable_rate: 67.04,
    late_rate: 12.06,
    breakout_rate: 7.5,
  },
];

// 2号艇の選手（4002）のこのレースより前の5走。どれも2号艇・2コース進入。1号艇の ST を並べてレースの最速を決める
//   r1: 自 .15・最速 .12（差 .03 で安定） / r2: 自 .10・1号艇 .18（最速で安定、内より .08 早く抜出） / r3: F / r4: L（ST なし） /
//   r5: 自 .30・最速 .14（差 .16 で出遅れ）。有効な ST は .15・.10・.30
const pastIds = [
  "2026-10-01-01-01",
  "2026-10-02-01-01",
  "2026-10-03-01-01",
  "2026-10-04-01-01",
  "2026-10-05-01-01",
];

const pastSt = [
  [0.15, 0.12],
  [0.1, 0.18],
  [0.02, 0.15],
  [null, 0.13],
  [0.3, 0.14],
];

// 3号艇の選手（4003）の走（2026-10-25 hq 依頼、FT01 の PR A）。今節（会場1の10/10・10/11）と別の会場の1走
//   10/10 5R: 3号艇・実進入2（前づけ）・ST .12・1着（差し）・F持ち（f_count 1）・風6m・波5cm・展示1位
//   10/11 3R: 3号艇・実進入3（枠なり）・ST .16・2着・F無し（f_count 0）・風2m・波2cm
//   9/01 1R（会場2）: 1号艇・実進入1・ST .11・1着・F数なし（null）・風7m・波0cm
export const r3 = {
  a: "2026-10-10-01-05",
  b: "2026-10-11-01-03",
  c: "2026-09-01-02-01",
};

const res = (race_id, over) => ({
  race_id,
  rank1: 1,
  rank2: 2,
  rank3: 4,
  rank4: 5,
  rank5: 6,
  rank6: 3,
  race_status: null,
  actual_course_1: 1,
  actual_course_2: 2,
  actual_course_3: 3,
  actual_course_4: 4,
  actual_course_5: 5,
  actual_course_6: 6,
  winning_technique: "逃げ",
  payout_win: 150,
  payout_place_1: 110,
  payout_place_2: 120,
  ...over,
});

export const rpcBodies = [];

function scene1() {
  racerStatsRaw = [
    {
      boatNumber: 1,
      course: 1,
      avgST: 0.15,
      courseRaceCounts: { 1: { total: 20, wins: 10 } },
      attackDistribution: { 1: { nige: 0.9, nuki: 0.1 } },
      defenseDistribution: { 1: { sashi: 0.5, makuri: 0.3, makurizashi: 0.2 } },
    },
    {
      boatNumber: 2,
      course: 2,
      avgST: 0.15,
      courseRaceCounts: { 2: { total: 30, wins: 4 } },
      attackDistribution: {
        2: { sashi: 0.5, makuri: 0.25, makurizashi: 0.25 },
      },
      defenseDistribution: {},
    },
    {
      boatNumber: 3,
      course: 3,
      avgST: 0.15,
      courseRaceCounts: { 3: { total: 10, wins: 1 } },
      attackDistribution: { 3: { makuri: 1 } },
      defenseDistribution: {},
    },
    {
      boatNumber: 4,
      course: 4,
      avgST: 0.15,
      courseRaceCounts: { 4: { total: 25, wins: 5 } },
      attackDistribution: structuredClone(COURSE_DEFAULT_DISTRIBUTION),
      defenseDistribution: {},
    },
    {
      boatNumber: 5,
      course: 5,
      avgST: 0.15,
      courseRaceCounts: { 5: { total: 12, wins: 2 }, 1: { total: 3, wins: 3 } },
      attackDistribution: { 5: { makurizashi: 1 } },
      defenseDistribution: {},
    },
  ];
  live.failRacer = null;
  live.predictionRows = [
    { racerStats: racerStatsRaw, predicted_at: `${date}T00:10:00+00:00` },
  ];
  scoped = {
    entries: pastIds.map((race_id) => ({
      race_id,
      boat_number: 2,
      grade: "A1",
      f_count: 0,
    })),
    races: pastIds.map((race_id) => ({
      race_id,
      race_date: race_id.slice(0, 10),
      venue_code: 1,
      race_grade: "ippan",
    })),
    results: pastIds.map((race_id) => ({
      race_id,
      rank1: 1,
      rank2: 3,
      rank3: 4,
      rank4: 5,
      rank5: 6,
      rank6: 2,
      race_status: null,
      actual_course_1: 1,
      actual_course_2: 2,
      actual_course_3: 3,
      actual_course_4: 4,
      actual_course_5: 5,
      actual_course_6: 6,
      winning_technique: "逃げ",
      payout_win: 150,
    })),
    st: pastIds.flatMap((race_id, i) => [
      {
        race_id,
        boat_number: 1,
        start_timing: pastSt[i][1],
        is_flying: false,
        finish_mark: "1",
        entry_course: 1,
      },
      {
        race_id,
        boat_number: 2,
        start_timing: pastSt[i][0],
        is_flying: i === 2,
        finish_mark: i === 3 ? "L" : i === 2 ? "F" : "6",
        entry_course: 2,
      },
    ]),
  };
}

function scene2() {
  scoped3 = {
    entries: [
      { race_id: r3.c, boat_number: 1, grade: "B1", f_count: null },
      { race_id: r3.a, boat_number: 3, grade: "B1", f_count: 1 },
      { race_id: r3.b, boat_number: 3, grade: "B1", f_count: 0 },
    ],
    races: [r3.a, r3.b, r3.c].map((race_id) => ({
      race_id,
      race_date: race_id.slice(0, 10),
      venue_code: Number(race_id.slice(11, 13)),
      race_grade: "ippan",
    })),
    results: [
      res(r3.a, {
        rank1: 3,
        rank2: 1,
        rank3: 2,
        rank6: 4,
        actual_course_3: 2,
        actual_course_2: 3,
        winning_technique: "差し",
      }),
      res(r3.b, { rank2: 3, rank3: 2 }),
      res(r3.c, {}),
    ],
    st: [
      {
        race_id: r3.a,
        boat_number: 3,
        start_timing: 0.12,
        is_flying: false,
        finish_mark: "1",
        entry_course: 2,
      },
      {
        race_id: r3.b,
        boat_number: 3,
        start_timing: 0.16,
        is_flying: false,
        finish_mark: "2",
        entry_course: 3,
      },
      {
        race_id: r3.c,
        boat_number: 1,
        start_timing: 0.11,
        is_flying: false,
        finish_mark: "1",
        entry_course: 1,
      },
    ],
    ex: [
      { race_id: r3.a, boat_number: 3, exhibition_time: 6.7 },
      { race_id: r3.a, boat_number: 1, exhibition_time: 6.8 },
      { race_id: r3.b, boat_number: 3, exhibition_time: 6.75 },
    ],
    conditions: [
      {
        race_id: r3.a,
        race_stage: "予選",
        race_title: "x杯",
        weather: "晴",
        wind_speed: 6,
        wave_height: 5,
        series_day: 3,
        is_final_day: false,
      },
      {
        race_id: r3.b,
        race_stage: "予選",
        race_title: "x杯",
        weather: "曇り",
        wind_speed: 2,
        wave_height: 2,
        series_day: 4,
        is_final_day: false,
      },
      {
        race_id: r3.c,
        race_stage: "一般",
        race_title: "y杯",
        weather: "雨",
        wind_speed: 7,
        wave_height: 0,
        series_day: 1,
        is_final_day: false,
      },
    ],
  };
  live.failConditions = false;
  live.failExhibition = false;
}

function scene3() {
  live.accidentRows = [
    {
      racer_id: 4003,
      starts: 40,
      incidents: [
        { race_id: r3.c, code: "F", stage: null },
        { race_id: r3.a, code: "S2", stage: "予選" },
      ],
    },
  ];
  // オリジナル展示: 会場は 一周・まわり足・直線 の3項目（半周ラップが無い）。2号艇の直線は欠測、6号艇は値の行が無い
  live.origHeader = [
    {
      measure_status: 1,
      item_count: 3,
      item_labels: "一周|まわり足|直線",
      updated_at: `${date}T06:50:00+00:00`,
    },
  ];
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runFullPictureScene2B2() {
  scene1();
  scene2();
  scene3();
}
