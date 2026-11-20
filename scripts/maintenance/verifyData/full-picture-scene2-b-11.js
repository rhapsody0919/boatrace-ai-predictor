/**
 * verify-full-picture-scene2.js の後半の場面（11/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { noStage, noPeriods } from "./full-picture-scene2-b-10.js";
import { live, date } from "./full-picture-scene2-b-1.js";
import { run, pre } from "./full-picture-scene2-b-4.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let MATERIALS_SCHEMA, validate;
let classifyFinalRide, FINAL_RIDE_KINDS, FINAL_RECORD_SOURCES, frProps, gaps, g3, lateOrig, mixedTz;
export let keepHeader, keepValues, unknownKind;

async function scene1() {
  assert.ok(
    noStage.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.final_race_record" &&
        /読めない/.test(x.reason),
    ),
    "読めない成績を艇ごとに記録",
  );
  assert.ok(
    noPeriods.db.exhibition.boats.every((b) => b.period_finals === null) &&
      noPeriods.db.exhibition.boats[0].final_race_record?.runs === 2,
    "期の表が読めなければ優出・優勝だけ null",
  );
  assert.ok(
    noPeriods.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.period_finals" &&
        /読めない/.test(x.reason),
    ),
    "読めない期を艇ごとに記録",
  );
  // 1走の分類（アーカイブの表記）と、出す値と契約の enum
  ({ classifyFinalRide, FINAL_RIDE_KINDS, FINAL_RECORD_SOURCES } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`));
  assert.deepEqual(
    ["01", "02", "06", "F", "L0", "L1", "K0", "K1", "S0", "S2", null].map(
      (finish) => classifyFinalRide({ source: "kb_archive", finish }),
    ),
    [
      "win",
      "run",
      "run",
      "fl",
      "fl",
      "fl",
      "absent",
      "absent",
      "run",
      "run",
      "absent",
    ],
    "アーカイブの成績コードの分類",
  );
  assert.deepEqual(
    ["1", "2", "F", "L", "欠", "転", "妨", null].map((finish) =>
      classifyFinalRide({ source: "races", finish, rank1: 3, boatNumber: 3 }),
    ),
    ["win", "run", "fl", "fl", "absent", "run", "run", "win"],
    "本体の着の表記の分類",
  );
  frProps = MATERIALS_SCHEMA.properties.db.properties.exhibition.properties.boats.items
      .properties.final_race_record.properties;
  assert.deepEqual(
    frProps.rides.items.properties.kind.enum,
    FINAL_RIDE_KINDS,
    "1走の分類はすべて契約にある",
  );
  assert.deepEqual(
    [
      frProps.rides.items.properties.source.enum,
      frProps.windows.items.properties.source.enum,
    ],
    [FINAL_RECORD_SOURCES, FINAL_RECORD_SOURCES],
    "窓の元はすべて契約にある",
  );
  // 欠けの形: race_conditions が読めない・事故の RPC が読めない・オリジナル展示が未公開・締切の後の書き換え
  live.failConditions = true;
  live.accidentRows = "fail";
  keepHeader = live.origHeader;
  keepValues = live.origValues;
  live.origHeader = [];
  live.origValues = [];
  gaps = await run({ conditions: pre });
  assert.deepEqual(validate(gaps), [], "欠けた材料も契約に合う");
  g3 = gaps.db.exhibition.boats[2];
  assert.deepEqual(
    [
      g3.condition_rows.wave5,
      g3.condition_rows.firstDay,
      g3.condition_rows.local?.n,
      g3.condition_stats,
      g3.meet_results.length,
      g3.st_consideration?.n,
    ],
    [null, null, 2, null, 2, 1],
    "race_conditions が読めなければ波・日目の行と選手ページの条件別だけ null（画面も出さない）",
  );
  assert.ok(
    gaps.missing.some(
      (x) => x.source === "db.exhibition.boats.conditions.racer.4003",
    ),
    "読めない race_conditions を記録",
  );
}

async function scene2() {
  assert.ok(
    gaps.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.condition_rows.wave5" &&
        /未取得/.test(x.reason),
    ),
    "出さない行を記録",
  );
  assert.ok(
    gaps.db.exhibition.boats.every((b) => b.accident === null) &&
      gaps.missing.some((x) => x.source === "db.exhibition.boats.accident"),
    "事故の RPC が読めなければ null で記録",
  );
  assert.ok(
    gaps.missing.some((x) => x.source === "db.exhibition.boats.3.accident"),
    "事故率の欠けを艇ごとにも記録（/code-review 2026-10-26 #6）",
  );
  assert.ok(
    gaps.db.exhibition.boats.every((b) => b.original_exhibition === null) &&
      gaps.db.exhibition.originalExhibition.state === "no_row",
    "オリジナル展示の行が無ければ null・no_row",
  );
  assert.ok(
    gaps.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /行が無い/.test(x.reason),
    ),
    "未公開を記録",
  );
  live.failConditions = false;
  live.accidentRows = [];
  live.origHeader = [{ ...keepHeader[0], updated_at: `${date}T07:10:00+00:00` }];
  live.origValues = keepValues;
  lateOrig = await run({ conditions: pre });
  assert.ok(
    lateOrig.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後/.test(x.reason),
    ),
    "締切の後に書いた値を記録（値は残す）",
  );
  assert.equal(
    lateOrig.db.exhibition.boats[0].original_exhibition.一周.value,
    37.1,
    "締切の後でも値は残す",
  );
  // /code-review（2026-10-26）#4: 時刻の表記が違っても最も遅い書き込みで判定する（文字の順では 16:05+09:00 が遅く見える）
  live.origHeader = [{ ...keepHeader[0], updated_at: `${date}T07:10:00+00:00` }];
  live.origValues = keepValues.map((v) => ({
    ...v,
    updated_at: `${date}T16:05:00+09:00`,
  }));
  mixedTz = await run({ conditions: pre });
  assert.ok(
    mixedTz.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後（.*07:10/.test(x.reason),
    ),
    "#4 表記の違う時刻も数で比べる",
  );
  // #5: 既定・会場の項目に無い名前の項目の値も落とさない
  live.origHeader = [];
  live.origValues = [
    {
      boat_number: 1,
      kind: "展示周回",
      value: "36.5",
      updated_at: `${date}T06:50:00+00:00`,
    },
  ];
  unknownKind = await run({ conditions: pre });
  assert.deepEqual(
    unknownKind.db.exhibition.boats[0].original_exhibition.展示周回,
    { value: 36.5, status: "value" },
    "#5 名前の違う項目の値を残す",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（MATERIALS_SCHEMA・validate） */
export async function runFullPictureScene2B12(env) {
  ({ MATERIALS_SCHEMA, validate } = env);
  await scene1();
  await scene2();
}
