#!/usr/bin/env node
/**
 * 画面と全貌動画の材料が共有する整形（純関数）を固定する。DB接続は不要。
 *
 * 2026-10-25 hq 依頼（FT01 の PR A）で、画面のサービス層（src/services/supabaseDataService.js）の中にあった整形を純関数へ移し、
 * 材料（sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs）からも使う（画面と投稿の数字が食い違わないため）。
 * 移す前の関数と 3,000 通りの乱数の入力で値が一致することを確かめてから移した。ここでは移した後の形を固定する。
 *
 *   1. 材料が3つの純関数を import する。サービス層は同じ純関数と同じ値を返し、整形の写しを持たない（二重の実装に戻らない。
 *      RA42: 本文の正規表現から、偽の supabase クライアントの上でサービスの公開の入口を呼ぶ試験へ置き換えた。末尾の 5）
 *   2. buildRacerRaceHistoryRows（getRacerRaceHistory）: 使えない結果・会場の無い走を除く、raceId の昇順、
 *      着欄の記号の走は unranked、進入は本番STの進入→Kファイルの順、ST順位は F を除く
 *   3. groupLosingTechniqueRows（getLosingTechniqueStats）: 枠ごとにまとめ、last_updated は先頭の行
 *   4. shapeOriginalExhibition（getRaceOriginalExhibition）: 値の無い行は数えない、項目の並びは item_labels が正、
 *      ヘッダが無ければ既定の並び、値は数にする
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  useFakeSupabase as setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  LOSING_ROWS,
  ORIGINAL_EXHIBITION_TABLES,
  R,
  historyInput,
} from "./verifyData/full-picture-screen-shared.js";
import {
  buildRacerRaceHistoryRows,
  isUnrankedFinishMark,
} from "../../src/services/racerRaceHistoryRows.js";
import { groupLosingTechniqueRows } from "../../src/utils/losingTechnique.js";
import {
  shapeOriginalExhibition,
  ORIGINAL_EXHIBITION_KINDS,
} from "../../src/utils/originalExhibition.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerFakeServiceSupabase();

const materials = fs.readFileSync(
  path.join(
    __dirname,
    "../../sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs",
  ),
  "utf8",
);

// 1. 画面と材料の両方が同じ純関数を使う
for (const [name, from] of [
  ["buildRacerRaceHistoryRows", "racerRaceHistoryRows.js"],
  ["groupLosingTechniqueRows", "losingTechnique.js"],
  ["shapeOriginalExhibition", "originalExhibition.js"],
]) {
  assert.match(
    materials,
    new RegExp(
      `import \\{ ${name}[ ,][^}]*\\} from "[./]+src/(services|utils)/${from.replace(".", "\\.")}"`,
    ),
    `材料が ${name} を import する`,
  );
}
// 2. 出走履歴の行
const rows = buildRacerRaceHistoryRows(historyInput);
assert.deepEqual(
  rows.map((r) => r.raceId),
  [R[1], R[0]],
  "使えない結果・会場の無い走を除き、raceId の昇順",
);
assert.deepEqual(
  rows[1],
  {
    raceId: R[0],
    venueCode: 1,
    raceGrade: "ippan",
    raceStage: "予選",
    raceTitle: "x杯",
    weather: "晴",
    windSpeed: 5,
    waveHeight: 3,
    boatNumber: 2,
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    winningTechnique: "逃げ",
    payoutWin: 150,
    payoutPlace1: 110,
    payoutPlace2: 130,
    exhibitionTime: 6.71,
    startTiming: 0.15,
    isFlying: false,
    finishMark: "2",
    entryCourse: 3,
    stRank: 2,
    unranked: false,
  },
  "本番STの進入が無ければ Kファイルの実進入、ST順位は F を除いた順",
);
assert.deepEqual(
  [
    rows[0].unranked,
    rows[0].finishMark,
    rows[0].raceStage,
    rows[0].weather,
    rows[0].exhibitionTime,
    rows[0].raceGrade,
  ],
  [true, "転", null, null, null, null],
  "着欄の記号の走は着順に数えず、race_conditions・展示の無い走は null",
);
assert.deepEqual(
  ["", null, "1", "6", "F", "欠"].map(isUnrankedFinishMark),
  [false, false, false, false, true, true],
  "記号が無い・数字なら着順に従う",
);

// 3. 負けの決まり手
assert.deepEqual(
  groupLosingTechniqueRows([
    {
      boat_number: 1,
      losing_technique: "差し",
      count_90days: 30,
      total_losses_90days: 80,
      percentage: 37.5,
      last_updated: "2026-10-25",
    },
    {
      boat_number: 1,
      losing_technique: "まくり",
      count_90days: 20,
      total_losses_90days: 80,
      percentage: 25,
      last_updated: "2026-10-24",
    },
    {
      boat_number: 3,
      losing_technique: "逃げ",
      count_90days: 5,
      total_losses_90days: 200,
      percentage: 2.5,
      last_updated: "2026-10-24",
    },
  ]),
  {
    last_updated: "2026-10-25",
    data: {
      1: {
        total_races: 80,
        techniques: [
          { technique: "差し", count: 30, percentage: 37.5 },
          { technique: "まくり", count: 20, percentage: 25 },
        ],
      },
      3: {
        total_races: 200,
        techniques: [{ technique: "逃げ", count: 5, percentage: 2.5 }],
      },
    },
  },
  "枠ごとに並びのまままとめ、last_updated は先頭の行",
);
assert.deepEqual(groupLosingTechniqueRows([]), {
  last_updated: null,
  data: {},
});

// 4. オリジナル展示
assert.deepEqual(
  shapeOriginalExhibition(
    { item_labels: "一周|まわり足|直線", updated_at: "t" },
    [{ boat_number: 1, kind: "一周", value: null }],
  ),
  {
    state: "empty",
    capturedAt: null,
    kinds: [],
    byBoat: {},
    fetchFailed: true,
  },
  "値が1つも無ければ empty（キャッシュしない）",
);
assert.deepEqual(
  shapeOriginalExhibition(
    { item_labels: " 直線 | 一周 ", updated_at: "2026-10-25T05:00:00Z" },
    [
      { boat_number: 1, kind: "一周", value: "37.21" },
      { boat_number: 1, kind: "直線", value: 7.01 },
      { boat_number: 2, kind: "一周", value: null },
      { boat_number: 2, kind: "まわり足", value: "5.5" },
    ],
  ),
  {
    state: "published",
    capturedAt: "2026-10-25T05:00:00Z",
    kinds: ["直線", "一周"],
    byBoat: { 1: { 一周: 37.21, 直線: 7.01 }, 2: { まわり足: 5.5 } },
  },
  "並びは item_labels が正で、値のある項目だけ。宣言に無い項目の値も byBoat には残す",
);
assert.deepEqual(
  shapeOriginalExhibition(null, [
    { boat_number: 3, kind: "直線", value: "7" },
    { boat_number: 3, kind: "一周", value: "37" },
  ]).kinds,
  ["一周", "直線"],
  "ヘッダが無ければ既定の並び",
);
assert.deepEqual(ORIGINAL_EXHIBITION_KINDS, [
  "一周",
  "半周ラップ",
  "まわり足",
  "直線",
]);

// 5. サービス層（領域の Queries の公開の入口）を偽の supabase クライアントの上で呼ぶ。画面は材料と同じ純関数の値を返し、
//    整形の写しを持たない（写しが別の値を作れば、上の 2〜4 で固定した純関数の値と食い違って落ちる）
// 出走履歴: 2 の入力を、選手の窓（730日）の中の日付へ付け替えて表に置く（窓は今日から数えるので、固定の日付だと期限が来る）
const today = new Date().toISOString().slice(0, 10);
const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// R の日付の昇順に、今日の3〜6日前を割り当てる（並びを保つ）
const sortedDates = [...new Set(R.map((id) => id.slice(0, 10)))].sort();
let remapped = JSON.stringify(historyInput);
for (const id of R) {
  const newDate = addDays(today, -6 + sortedDates.indexOf(id.slice(0, 10)));
  remapped = remapped.replaceAll(id, `${newDate}${id.slice(10)}`);
}
const serviceInput = JSON.parse(remapped);
const SERVICE_RACER = 4201;
setFakeSupabase(
  createFakeSupabase({
    race_entries: [
      ...serviceInput.entries.map((e) => ({ ...e, racer_id: SERVICE_RACER })),
      // 別の選手の走は返さない
      {
        race_id: serviceInput.entries[0].race_id,
        boat_number: 5,
        racer_id: SERVICE_RACER + 1,
      },
    ],
    races: serviceInput.raceRows,
    race_results: serviceInput.resultRows,
    exhibition_data: serviceInput.exhibitionRows,
    race_conditions: serviceInput.conditionRows,
    race_start_timings: serviceInput.stRows,
    losing_technique_stats: LOSING_ROWS,
    ...ORIGINAL_EXHIBITION_TABLES,
  }),
);
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く
installLocalStorage();
const { clearCache } = await import("../../src/services/core.js");
const { getRacerRaceHistory } =
  await import("../../src/services/racerQueries2.js");
const { getLosingTechniqueStats } =
  await import("../../src/services/venueQueries2.js");
const { getRaceOriginalExhibition } =
  await import("../../src/services/raceQueries4.js");

clearCache();
const screenRows = await getRacerRaceHistory(SERVICE_RACER);
assert.deepEqual(
  screenRows,
  buildRacerRaceHistoryRows(serviceInput),
  "getRacerRaceHistory は buildRacerRaceHistoryRows と同じ値（別の選手の走・使えない結果・会場の無い走を含めて）",
);
assert.equal(screenRows.length, 2, "使えない結果・会場の無い走を除いた2走");
assert.equal(screenRows[1].entryCourse, 3, "進入は本番STの進入→Kファイルの順");

clearCache();
const screenLosing = await getLosingTechniqueStats(1);
const sharedLosing = groupLosingTechniqueRows(
  LOSING_ROWS.filter((r) => r.venue_code === 1),
);
assert.equal(screenLosing.venue_code, 1);
assert.equal(screenLosing.venue_name, "桐生");
assert.equal(screenLosing.last_updated, sharedLosing.last_updated);
assert.deepEqual(
  screenLosing.data,
  sharedLosing.data,
  "getLosingTechniqueStats は groupLosingTechniqueRows と同じ値（別の会場の行を含めない）",
);
assert.deepEqual(screenLosing.data[1].techniques, [
  { technique: "差し", count: 30, percentage: 37.5 },
  { technique: "まくり", count: 20, percentage: 25 },
]);
assert.equal(screenLosing.data[3], undefined, "別の会場の枠は無い");

clearCache();
assert.deepEqual(
  await getRaceOriginalExhibition("ox-1"),
  {
    state: "published",
    capturedAt: "2026-10-25T05:00:00Z",
    kinds: ["直線", "一周"],
    byBoat: { 1: { 一周: 37.21, 直線: 7.01 }, 2: { まわり足: 5.5 } },
  },
  "getRaceOriginalExhibition は shapeOriginalExhibition と同じ値（別のレースの値を含めない）",
);
clearCache();
assert.deepEqual(
  await getRaceOriginalExhibition("ox-3"),
  {
    state: "empty",
    capturedAt: null,
    kinds: [],
    byBoat: {},
    fetchFailed: true,
  },
  "ヘッダも値も無いレースは empty",
);

console.log("verify-full-picture-screen-shared: OK");
