/**
 * verify-full-picture-scene2.js の後半の場面（6/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { boats, got } from "./full-picture-scene2-b-4.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";
import { live } from "./full-picture-scene2-b-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let m;
let vc, outcomeRowsOf, placeRatesByBoat, nationalWinRateByBoat, vb, screenRates, nb;
export let nationalCourseOf, BASELINE_GRADES, pctRound2, boatTendencyOf, nc;

// 全国の1着率を api.outcome から独立に数える（3連単の組の件数を1着の艇で足す）
const byFirst = {};

async function scene1() {
  for (const k of ["course_technique", "period_course", "entry_tendency"]) {
    assert.equal(boats[5][k], null, `選手の分からない艇の ${k} は null`);
    assert.ok(
      got.missing.some(
        (x) =>
          x.source === `db.exhibition.boats.6.${k}` &&
          /選手が分からない/.test(x.reason),
      ),
      `選手の分からない艇の ${k} を記録`,
    );
  }
  // 会場のコース別の決まり手（レースのグレードと ALL の6コース）
  vc = got.db.exhibition.venueCourse;
  assert.equal(vc?.race_grade, "G1", "レースのグレードで引く");
  assert.deepEqual(
    vc.courses[0],
    {
      course: 1,
      runs: 136,
      nige_rate: 62.2,
      makuri_rate: 0,
      nigashi_rate: null,
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      last_updated: "2026-10-12",
    },
    "会場・グレードのコース別の逃げ率・まくり率・逃がし率と窓",
  );
  assert.deepEqual(
    [vc.courses.length, vc.courses[5], vc.all.map((r) => r.runs)],
    [6, null, [2103, 2103, 2103, 2103, 2103, 2103]],
    "6コース並べ、行の無いコースは null",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.venueCourse.G1.6"),
    "行の無いコースを記録",
  );
  assert.ok(
    !got.missing.some((x) => x.source === "db.exhibition.venueCourse"),
    "レースの日より前の集計なら欠けなし",
  );
  // ---- 全国×コース・会場×枠・全国×枠（2026-10-26 hq 依頼、FT01 オーナー「会場の特性を分岐の判定に使う」）----
  ({
    nationalCourseOf,
    BASELINE_GRADES,
    pctRound2,
    outcomeRowsOf,
    boatTendencyOf,
  } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`));
  ({ placeRatesByBoat, nationalWinRateByBoat } = await import("../../../src/utils/venuePlaceRates.js"));
  nc = got.db.exhibition.nationalCourse;
  assert.equal(nc?.race_grade, "G1", "全国もレースのグレードと ALL");
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("venue_course_technique_baseline?") &&
        !/venue_code=eq/.test(x) &&
        /order=venue_code,race_grade,course/.test(x),
    ),
    "全国は同じ表の24会場の行を1回で読む",
  );
  // 会場1の ALL 1コース: 62.2%×2103 → 1308回、他の23会場: 50%×1000 → 500回ずつ
  assert.deepEqual(
    nc.all[0],
    {
      course: 1,
      runs: 2103 + 23000,
      venues: 24,
      nige_count: 1308 + 11500,
      nige_rate: 51.02,
      makuri_count: 0 + 23 * 101,
      makuri_rate: 9.25,
      nigashi_count: null,
      nigashi_rate: null,
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      last_updated: "2026-10-12",
    },
    "全国の ALL 1コースは24会場の回数と走数の合計（RPC と同じ小数2桁の%）",
  );
  assert.deepEqual(
    [
      nc.courses[5]?.runs,
      nc.courses[5]?.venues,
      nc.courses[5]?.makuri_count,
      nc.courses[5]?.nigashi_count,
      nc.courses[5]?.nigashi_rate,
      nc.courses[5]?.nige_rate,
    ],
    [50, 1, 2, 26, 52, null],
    "行のある会場だけを足す（G1 の6コースは会場2だけ）。2〜6コースは逃がし率",
  );
}

function scene2() {
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.nationalCourse" &&
        /会場1 G1 2コースの makuri_rate 5\.1 から回数に戻せない/.test(x.reason),
    ),
    "率から回数に戻せない行を記録（固定の材料の会場1の行は作り物）",
  );
  assert.ok(
    !got.missing.some(
      (x) =>
        x.source === "db.exhibition.nationalCourse" &&
        /より後の集計|窓が違う|会場だけ/.test(x.reason),
    ),
    "窓がそろい24会場あり、レースの日より前なら欠けなし",
  );
  vb = got.db.exhibition.venueBoat;
  screenRates = placeRatesByBoat(m.api.outcome[m.venueCode]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => [
      vb.by_boat[n].win_rate,
      vb.by_boat[n].top2_rate,
      vb.by_boat[n].top3_rate,
    ]),
    screenRates.map((r) =>
      [r.winRate, r.top2Rate, r.top3Rate].map((v) => Number(v.toFixed(1))),
    ),
    "会場×枠の1着率・2連率・3連率は会場特徴カード（placeRatesByBoat）と同じ値の1桁",
  );
  assert.equal(
    vb.total_races,
    m.api.outcome[m.venueCode].total_races,
    "会場の90日のレース数",
  );
  assert.deepEqual(
    vb.by_boat[1].top_technique,
    { technique: "逃げ", percentage: 93.45 },
    "主な決まり手は percentage の最大（カードの techniques[0]）",
  );
  assert.deepEqual(
    [vb.by_boat[1].technique_total, vb.by_boat[1].techniques],
    [
      412,
      [
        { technique: "逃げ", count: 385, share: 93.4 },
        { technique: "抜き", count: 27, share: 6.6 },
      ],
    ],
    "決まり手の内訳は techniqueBreakdown（固定の順・1着の回数の中の割合）",
  );
  assert.deepEqual(
    [
      vb.by_boat[2].top_technique,
      vb.by_boat[2].technique_total,
      vb.by_boat[2].techniques,
    ],
    [null, 0, []],
    "決まり手の行の無い枠は0件",
  );
  assert.equal(vb.technique_last_updated, "2026-10-25", "決まり手の集計の日");
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.venueBoat")),
    "会場の決まり手の集計の日は technique.byBoat に記録済みで重ねない（/code-review #6）",
  );
  nb = got.db.exhibition.nationalBoat;
  live.pooledN = 0;
  for (const o of Object.values(m.api.outcome))
    for (const [first, ps] of Object.entries(o.data))
      for (const x of ps)
        ((byFirst[first] = (byFirst[first] ?? 0) + x.count),
          (live.pooledN += x.count));
  assert.deepEqual(
    [nb.count_total, nb.venues, nb.technique_venues, nb.total_races],
    [
      live.pooledN,
      24,
      24,
      Object.values(m.api.outcome).reduce((a, o) => a + o.total_races, 0),
    ],
    "全国は24会場のプール（分母は組の件数の合計）",
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => nb.by_boat[n].win_rate),
    [1, 2, 3, 4, 5, 6].map((n) =>
      Number(((byFirst[n] / live.pooledN) * 100).toFixed(1)),
    ),
    "全国×枠の1着率は全国平均の目盛りと同じ数え方の1桁",
  );
  assert.equal(
    nb.by_boat[1].win_rate,
    Number(nationalWinRateByBoat(outcomeRowsOf(m.api.outcome))[1].toFixed(1)),
    "画面の全国平均と同じ関数",
  );
  assert.ok(
    !seenQueries.some((x) => x.startsWith("outcome_distribution?")),
    "1着率は取得済みの api.outcome を使い、表を読み直さない（/code-review #3）",
  );
}

function scene3() {
  assert.deepEqual(
    [nb.by_boat[1].technique_total, nb.by_boat[1].techniques],
    [
      289,
      [
        { technique: "逃げ", count: 240, share: 83 },
        { technique: "抜き", count: 48, share: 16.6 },
        { technique: "恵まれ", count: 1, share: 0.3 },
      ],
    ],
    "全国×枠の決まり手は24会場の回数を足した内訳",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（m） */
export async function runFullPictureScene2B7(env) {
  ({ m } = env);
  await scene1();
  scene2();
  scene3();
}
