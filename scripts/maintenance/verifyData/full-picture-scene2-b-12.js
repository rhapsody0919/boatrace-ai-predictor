/**
 * verify-full-picture-scene2.js の後半の場面（12/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { has } from "./full-picture-scene2-a-1.js";
import { unknownKind, keepHeader, keepValues } from "./full-picture-scene2-b-11.js";
import { live, date } from "./full-picture-scene2-b-1.js";
import { run, pre, got } from "./full-picture-scene2-b-4.js";
import { racerStatsRaw } from "./full-picture-scene2-b-2.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let validate, MATERIALS_SCHEMA;
let noEx, notMeasured, ORIGINAL_EXHIBITION_STATUSES, conditionStatsOf, oeProps, hist, cs, noPred, noGrade;

async function scene1() {
  assert.deepEqual(
    validate(unknownKind),
    [],
    "#5 名前の違う項目を含む材料も契約に合う",
  );
  // #1: 選手の走の展示が読めなくても ST考察・条件別は残す
  live.origHeader = keepHeader;
  live.origValues = keepValues;
  live.failExhibition = true;
  noEx = await run({ conditions: pre });
  live.failExhibition = false;
  assert.deepEqual(
    [
      noEx.db.exhibition.boats[1].st_consideration?.n,
      noEx.db.exhibition.boats[2].condition_rows?.local?.n,
      noEx.db.exhibition.boats[2].meet_results?.[0]?.exhibition_time,
    ],
    [3, 2, null],
    "#1 展示が読めなければ展示の値だけ null",
  );
  assert.ok(
    noEx.missing.some(
      (x) => x.source === "db.exhibition.boats.exhibition.racer.4003",
    ),
    "#1 読めない展示を記録",
  );
  live.origHeader = [{ ...keepHeader[0], measure_status: 2 }];
  live.origValues = [];
  notMeasured = await run({ conditions: pre });
  assert.deepEqual(
    [
      notMeasured.db.exhibition.originalExhibition.state,
      notMeasured.db.exhibition.originalExhibition.measure_status,
    ],
    ["empty", 2],
    "計測不可は empty と measure_status=2",
  );
  assert.ok(
    notMeasured.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /計測不可/.test(x.reason),
    ),
    "計測不可を記録",
  );
  live.origHeader = keepHeader;
  live.origValues = keepValues;
  live.accidentRows = [{ racer_id: 4003, starts: 40, incidents: [] }];
  // 契約の enum の漏れ（#1905 の Codex P1 と同じ型の検査）: 出す値の状態がすべて契約にある
  ({ ORIGINAL_EXHIBITION_STATUSES, conditionStatsOf } = await import(
    `${R}/scripts/full-picture/fetch-materials.mjs`
  ));
  oeProps = MATERIALS_SCHEMA.properties.db.properties.exhibition.properties.boats.items
      .properties;
  assert.deepEqual(
    oeProps.original_exhibition.additionalProperties.properties.status.enum,
    ORIGINAL_EXHIBITION_STATUSES,
    "オリジナル展示の状態はすべて契約にある",
  );
  assert.deepEqual(
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties
      .originalExhibition.properties.state.enum,
    ["published", "empty", "no_row"],
    "レースの状態はすべて契約にある",
  );
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          boats: got.db.exhibition.boats.map((b, i) =>
            i === 1
              ? {
                  ...b,
                  original_exhibition: {
                    ...b.original_exhibition,
                    一周: { value: 1, status: "x" },
                  },
                }
              : b,
          ),
        },
      },
    }),
    "value|no_value|not_offered",
  );
}

async function scene2() {
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          boats: got.db.exhibition.boats.map((b, i) =>
            i === 2 ? { ...b, accident: { ...b.accident, status: "bad" } } : b,
          ),
        },
      },
    }),
    "over|near|",
  );
  // 選手ページの条件別は、5走以上の条件を出す（率は%）
  hist = [6, 6, 6, 2, 7].map((w, i) => ({
    raceId: `2026-10-0${i + 1}-02-01`,
    venueCode: 2,
    boatNumber: 1,
    rank1: i < 2 ? 1 : 2,
    rank2: i < 2 ? 2 : 1,
    rank3: 3,
    weather: "晴",
    windSpeed: w,
    waveHeight: 6,
    unranked: false,
  }));
  cs = conditionStatsOf(hist);
  assert.deepEqual(
    [cs.rows.waveRough, cs.rows.windStrong, cs.rows.sunny.n],
    [
      {
        group: "波高",
        label: "波5cm以上",
        n: 5,
        win_rate: 40,
        top2_rate: 100,
        top3_rate: 100,
      },
      undefined,
      5,
    ],
    "5走以上の条件だけ出し、率は%の1桁（風5m以上は4走で出ない）",
  );
  // 予想が無い・読めないときも艇の材料は残す
  live.predictionRows = [];
  noPred = await run({ conditions: pre });
  assert.deepEqual(validate(noPred), [], "予想の無い材料も契約に合う");
  assert.ok(
    noPred.db.exhibition.boats.every((b) => b.attack_defense === null) &&
      noPred.db.exhibition.boats[1].st_consideration?.n === 3,
    "予想が無ければ超展開データだけ null",
  );
  assert.ok(
    noPred.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.attack_defense" &&
        /standard の予想が無い/.test(x.reason),
    ),
    "予想が無いことを記録",
  );
  live.predictionRows = [
    { racerStats: racerStatsRaw, predicted_at: `${date}T00:10:00+00:00` },
  ];
  live.baseline = live.baseline.map((r) => ({ ...r, window_end: date }));
  noGrade = await run({ conditions: pre, grade: null });
  assert.deepEqual(validate(noGrade), [], "グレードの無い材料も契約に合う");
  assert.ok(
    noGrade.missing.some(
      (x) =>
        x.source === "db.exhibition.venueCourse" &&
        /venue_course_technique_baseline はレースの日.*より後の集計/.test(
          x.reason,
        ),
    ),
    "会場の集計がレースの日を含めば記録",
  );
  assert.equal(
    noGrade.db.exhibition.venueCourse?.race_grade,
    "ippan",
    "グレードが無ければ ippan で引く",
  );
  assert.ok(
    noGrade.missing.some(
      (x) => x.source === "db.exhibition.venueCourse.race_grade",
    ),
    "グレードが無いことを記録",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("venue_course_technique_baseline?") &&
        /race_grade=in\.\(ippan,ALL\)/.test(x),
    ),
    "ippan と ALL を読む",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate・MATERIALS_SCHEMA） */
export async function runFullPictureScene2B13(env) {
  ({ validate, MATERIALS_SCHEMA } = env);
  await scene1();
  await scene2();
}
