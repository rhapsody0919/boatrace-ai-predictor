/**
 * verify-full-picture-scene2.js の後半の場面（7/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { has } from "./full-picture-scene2-a-1.js";
import { got, boats } from "./full-picture-scene2-b-4.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";
import { boatTendencyOf, pctRound2, nationalCourseOf, BASELINE_GRADES, nc } from "./full-picture-scene2-b-6.js";
import { technique, techAll } from "./full-picture-scene2-b-1.js";

let MATERIALS_SCHEMA, validate, m;
let partial, ncOnly;

// 画面と同じ定義の材料（2026-10-25 hq 依頼、FT01）。超展開データは画面と同じ関数（src/utils/attackDefenseCells.js）
const adOf = (n) => boats[n - 1].attack_defense;

const cellsOf = (n, key) =>
  Object.fromEntries(
    Object.entries(adOf(n).cells).map(([k, c]) => [k, c[key]]),
  );

function scene1() {
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.nationalBoat")),
    "24会場そろいレースの日より前の集計なら欠けなし",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("winning_technique_stats?") &&
        /order=venue_code,boat_number,winning_technique/.test(x),
    ),
    "全会場の決まり手は並べ替えて読む",
  );
  // 1会場の outcome-distribution が取れないと全国は23会場で、記録する
  partial = boatTendencyOf(
    m.venueCode,
    { ...m.api.outcome, 5: null },
    technique.winning_technique_stats,
    techAll,
  );
  assert.equal(partial.nationalBoat.venues, 23, "取れなかった会場は数えない");
  // RPC（PostgreSQL の ROUND）と同じ四捨五入（/code-review #1: 23/160=14.375 を浮動小数で丸めると 14.37 になる）
  assert.deepEqual(
    [
      pctRound2(23, 160),
      pctRound2(1, 3),
      pctRound2(2, 3),
      pctRound2(1308, 2103),
    ],
    [14.38, 33.33, 66.67, 62.2],
    "回数/走数の%の2桁は半分を上へ",
  );
  assert.ok(
    !nationalCourseOf(
      [
        {
          venue_code: 1,
          race_grade: "ALL",
          course: 2,
          runs: 160,
          nige_rate: null,
          makuri_rate: 14.38,
          nigashi_rate: 50,
          window_start: "a",
          window_end: "b",
          last_updated: "c",
        },
      ],
      "ALL",
    ).problems.some((x) => /戻せない/.test(x)),
    "RPC の丸めの 14.38 は 23回に戻る",
  );
  // 純関数: 会場の行が欠けた・窓が違う・ALL が24会場にない
  ncOnly = nationalCourseOf(
    [
      {
        venue_code: 3,
        race_grade: "ALL",
        course: 1,
        runs: 7,
        nige_rate: 57.14,
        makuri_rate: 0,
        nigashi_rate: null,
        window_start: "2025-12-02",
        window_end: "2026-10-11",
        last_updated: "2026-10-12",
      },
      {
        venue_code: 4,
        race_grade: "ALL",
        course: 1,
        runs: 3,
        nige_rate: 33.33,
        makuri_rate: 33.33,
        nigashi_rate: null,
        window_start: "2025-12-03",
        window_end: "2026-10-11",
        last_updated: "2026-10-13",
      },
    ],
    "ALL",
  );
  assert.deepEqual(
    [
      ncOnly.all[0].runs,
      ncOnly.all[0].nige_count,
      ncOnly.all[0].nige_rate,
      ncOnly.all[0].makuri_count,
      ncOnly.all[0].last_updated,
      ncOnly.courses === ncOnly.all,
      ncOnly.all[1],
    ],
    [10, 5, 50, 1, "2026-10-13", true, null],
    "4/7 と 1/3 を戻して 5/10、行の無いコースは null",
  );
}

function scene2() {
  assert.ok(
    ["窓が違う", "ALL 2コースの行が1会場も無い", "2会場だけ"].every((w) =>
      ncOnly.problems.some((p) => p.includes(w)),
    ),
    "窓の食い違い・行の無いコース・会場の不足を書く",
  );
  // 契約の enum（出す値の race_grade がすべて契約にある）
  assert.deepEqual(
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties
      .nationalCourse.properties.race_grade.enum,
    BASELINE_GRADES,
    "全国×コースのグレードはすべて契約にある",
  );
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          nationalCourse: { ...nc, race_grade: "G4" },
        },
      },
    }),
    "SG|G1|G2|G3|ippan|ALL",
  );
  assert.ok(
    (got.db.exhibition.notes ?? []).some((x) =>
      /racer_course_technique_stats・venue_course_technique_baseline・racer_aggregated_stats は最新の値だけ/.test(
        x,
      ),
    ),
    "日付の無い表の注意を出力に書く",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("predictions?") &&
        /model_id=eq\.standard/.test(x) &&
        /order=predicted_at\.desc/.test(x) &&
        /limit=1/.test(x),
    ),
    "画面と同じ予想（standard の最新）の racerStats を読む",
  );
  assert.deepEqual(
    [adOf(1).role, adOf(1).wins, adOf(1).total, cellsOf(1, "value")],
    [
      "defense",
      10,
      20,
      {
        nige: "9/20",
        sashi: "5/20",
        makuri: "3/20",
        makurizashi: "2/20",
        other: "0/20",
      },
    ],
    "1号艇は逃げと差され・まくられ・捲差され（割合×直近365日の勝ち・負け数を丸めた回数／出走）",
  );
  assert.deepEqual(
    [cellsOf(2, "value"), cellsOf(2, "state")],
    [
      {
        nige: null,
        sashi: "2/30",
        makuri: "1/30",
        makurizashi: "1/30",
        other: "0/30",
      },
      {
        nige: "none",
        sashi: "reference",
        makuri: "reference",
        makurizashi: "reference",
        other: "reference",
      },
    ],
    "全枠の勝ちが2〜4は参考（画面の※）、2〜6号艇の逃げは「-」",
  );
  assert.deepEqual(
    [
      cellsOf(3, "value").sashi,
      cellsOf(3, "state").sashi,
      cellsOf(3, "screen_value").sashi,
    ],
    [null, "national_default", "12%"],
    "勝ちが2未満は画面が全国平均の%なので、選手の値として出さない（画面の文字は screen_value）",
  );
  assert.deepEqual(
    [
      cellsOf(4, "value").sashi,
      cellsOf(4, "state").sashi,
      cellsOf(4, "screen_value").sashi,
    ],
    [null, "national_default_distribution", "1/25"],
    "決まり手の内訳が全国の既定（全期間の勝ち5未満）なら、画面に回数が出ても選手の値として出さない",
  );
}

function scene3() {
  assert.deepEqual(
    cellsOf(5, "value"),
    {
      nige: null,
      sashi: "0/12",
      makuri: "0/12",
      makurizashi: "2/12",
      other: "0/12",
    },
    "勝ちの合計は全枠（5号艇2＋1号艇3）で判定する",
  );
  assert.equal(adOf(6), null, "racerStats に無い艇は null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.6.attack_defense" &&
        /racerStats にこの艇が無い/.test(x.reason),
    ),
    "racerStats に無い艇を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.attack_defense" &&
        /sashi\(national_default\)/.test(x.reason),
    ),
    "全国平均の値を出さないことを記録",
  );
  assert.deepEqual(
    [
      adOf(3).exhibition_course_differs,
      adOf(1).exhibition_course_differs,
      adOf(3).basis,
    ],
    [true, false, "boat_number"],
    "展示の進入が枠と違う艇に印を付ける（値は枠番のまま）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（MATERIALS_SCHEMA・validate・m） */
export function runFullPictureScene2B8(env) {
  ({ MATERIALS_SCHEMA, validate, m } = env);
  scene1();
  scene2();
  scene3();
}
