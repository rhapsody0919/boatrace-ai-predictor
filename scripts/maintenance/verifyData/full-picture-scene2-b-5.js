/**
 * verify-full-picture-scene2.js の後半の場面（5/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { boats, got, conditions, pre, tq } from "./full-picture-scene2-b-4.js";
import { technique, date } from "./full-picture-scene2-b-1.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";

function scene1() {
  assert.deepEqual(
    Object.entries(boats[5]).filter(
      ([k]) =>
        ![
          "boat_number",
          "meet_finishes",
          "course",
          "course_source",
          "original_exhibition",
        ].includes(k),
    ),
    Object.keys(boats[0])
      .filter(
        (k) =>
          ![
            "boat_number",
            "meet_finishes",
            "course",
            "course_source",
            "original_exhibition",
          ].includes(k),
      )
      .map((k) => [k, null]),
    "行の無い艇は全欄 null（今節の着順は facts から、進入コースは枠番で、オリジナル展示は別の表から別に取る）",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.6"),
    "行の無い艇を missing に記録",
  );
  assert.ok(
    !got.missing.some((x) =>
      /\.(start_flag|parts_changed|propeller_change)$/.test(x.source),
    ),
    "印・交換の null は「表示なし」で欠けにしない",
  );
  assert.deepEqual(
    conditions,
    {
      weather: "曇り",
      wind_direction: "北",
      wind_speed: 1,
      wave_height: 2,
      observedAt: pre.weather_observed_at,
    },
    "締切より前の風・波を出す",
  );
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.conditions")),
    "発走前の値がそろえば欠けなし",
  );
  assert.deepEqual(
    tq,
    {
      byPeriod: technique.venue_technique_period_stats,
      byBoat: technique.winning_technique_stats,
    },
    "決まり手の過去の分布は会場の既存の集計表をそのまま写す",
  );
  // 選手のコース別の成績（既存の表を写すだけ）。進入コースは展示の進入、無ければ枠番
  assert.deepEqual(
    boats.map((b) => b.today_weight),
    [52.3, 50, 51, 53, null, null],
    "展示の体重を出し、欠けは null",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.5.today_weight"),
    "体重の欠けを記録",
  );
  assert.deepEqual(
    boats.map((b) => [b.racer_id, b.course, b.course_source]),
    [
      [4001, 1, "exhibition_course"],
      [4002, 2, "exhibition_course"],
      [4003, 4, "exhibition_course"],
      [4004, 3, "exhibition_course"],
      [4005, 5, "boat_number"],
      [null, 6, "boat_number"],
    ],
    "進入コースと引いた元",
  );
}

function scene2() {
  assert.deepEqual(
    boats[0].course_technique,
    {
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      window_days: 314,
      runs: 25,
      nige_count: 10,
      nige_rate: 40,
      makuri_count: 2,
      makuri_rate: 8,
      nigashi_count: null,
      nigashi_rate: null,
      runs_90d: 6,
      nige_rate_90d: 50,
      makuri_rate_90d: 0,
      nigashi_rate_90d: null,
      last_updated: "2026-10-12",
    },
    "その選手のその進入コースの逃げ・まくり・逃がしの回数と率、90日の率",
  );
  assert.equal(
    boats[2].course_technique?.window_end,
    date,
    "3号艇は展示の進入（4コース）の行を引く（枠番の3コースでない）",
  );
  assert.equal(
    boats[4].course_technique?.runs,
    25,
    "進入の無い艇は枠番のコースで引く",
  );
  assert.equal(boats[1].course_technique, null, "行の無い選手・コースは null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.course_technique" &&
        /2コースの行が無い/.test(x.reason),
    ),
    "行の無いコースを記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.course_technique" &&
        /racer_course_technique_stats はレースの日.*より後の集計/.test(
          x.reason,
        ),
    ),
    "レースの日を含む集計を記録",
  );
  assert.ok(
    !got.missing.some(
      (x) => x.source === "db.exhibition.boats.1.course_technique",
    ),
    "レースの日より前の集計なら欠けなし",
  );
  assert.deepEqual(
    boats[0].period_course,
    {
      period_year: 2026,
      period_no: 1,
      calc_to: "2026-04-30",
      course: 1,
      entries: 11,
      avg_st: 0.26,
      avg_start_rank: 2.5,
      f: 14,
      l0: 15,
      l1: 16,
      p1: 17,
      p2: 18,
      p3: 19,
    },
    "calc_to < レースの日 の最新の期の、その進入コースの cN_*（レースの日より後に締めた期は使わない）",
  );
  assert.deepEqual(
    [boats[2].period_course?.course, boats[2].period_course?.entries],
    [4, 34],
    "期の成績も進入コースの列（c4_*）",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("racer_period_stats?") && x.includes(`calc_to.lt.${date}`),
    ),
    "期は calc_to < レースの日 で読む",
  );
  assert.equal(boats[1].period_course, null, "期の無い選手は null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.2.period_course"),
    "期の無い選手を記録",
  );
}

function scene3() {
  assert.deepEqual(
    boats[0].entry_tendency,
    {
      boat_number: 1,
      n: 36,
      courses: { 1: 35, 2: 1 },
      venue: { n: 3, courses: { 1: 3 } },
      since: "2025-10-11",
      calculated_at: "2026-10-11T14:23:07+00:00",
    },
    "その枠の進入の分布と since",
  );
  assert.equal(boats[4].entry_tendency, null, "その枠の進入が無ければ null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.5.entry_tendency" &&
        /5号艇の進入が無い/.test(x.reason),
    ),
    "枠の進入が無いことを記録",
  );
  assert.equal(
    boats[3].entry_tendency,
    null,
    "集計がこのレース以後の出走を含めば null（API と同じ）",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.4.entry_tendency" &&
        /racer_aggregated_stats はレースの日.*より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.entry_tendency" &&
        /racers にこの艇が無い/.test(x.reason),
    ),
    "racers に無い艇を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.entry_tendency" &&
        /全国の行が無い/.test(x.reason),
    ),
    "行の無い選手を記録",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runFullPictureScene2B6() {
  scene1();
  scene2();
  scene3();
}
