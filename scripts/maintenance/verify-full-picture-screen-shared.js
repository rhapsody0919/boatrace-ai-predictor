#!/usr/bin/env node
/**
 * 画面と全貌動画の材料が共有する整形（純関数）を固定する。DB接続は不要。
 *
 * 2026-10-25 hq 依頼（FT01 の PR A）で、画面のサービス層（src/services/supabaseDataService.js）の中にあった整形を純関数へ移し、
 * 材料（sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs）からも使う（画面と投稿の数字が食い違わないため）。
 * 移す前の関数と 3,000 通りの乱数の入力で値が一致することを確かめてから移した。ここでは移した後の形を固定する。
 *
 *   1. サービス層が3つの純関数を import し、整形の写しを持たない（二重の実装に戻らない）
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
  buildRacerRaceHistoryRows,
  isUnrankedFinishMark,
} from "../../src/services/racerRaceHistoryRows.js";
import { groupLosingTechniqueRows } from "../../src/utils/losingTechnique.js";
import {
  shapeOriginalExhibition,
  ORIGINAL_EXHIBITION_KINDS,
} from "../../src/utils/originalExhibition.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const service = fs.readFileSync(
  path.join(__dirname, "../../src/services/supabaseDataService.js"),
  "utf8",
);
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
    service,
    new RegExp(
      `import \\{ ${name} \\} from "[./]+(utils/)?${from.replace(".", "\\.")}"`,
    ),
    `サービス層が ${name} を import する`,
  );
  assert.match(
    materials,
    new RegExp(
      `import \\{ ${name}[ ,][^}]*\\} from "[./]+src/(services|utils)/${from.replace(".", "\\.")}"`,
    ),
    `材料が ${name} を import する`,
  );
}
assert.doesNotMatch(
  service,
  /payoutPlace1: result\.payout_place_1/,
  "サービス層に出走履歴の整形の写しが無い",
);
assert.doesNotMatch(
  service,
  /technique: row\.losing_technique/,
  "サービス層に負けの決まり手のまとめの写しが無い",
);
assert.doesNotMatch(
  service,
  /const ORIGINAL_EXHIBITION_KINDS|const measured = values\.filter/,
  "サービス層にオリジナル展示の整形の写しが無い",
);

// 2. 出走履歴の行
const result = (race_id, over = {}) => ({
  race_id,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  rank4: 4,
  rank5: 5,
  rank6: 6,
  race_status: null,
  winning_technique: "逃げ",
  payout_win: 150,
  payout_place_1: 110,
  payout_place_2: 130,
  actual_course_1: 1,
  actual_course_2: 3,
  actual_course_3: 2,
  actual_course_4: 4,
  actual_course_5: 5,
  actual_course_6: 6,
  ...over,
});
const R = [
  "2026-10-02-01-01",
  "2026-10-01-01-01",
  "2026-10-03-02-01",
  "2026-10-04-02-01",
];
const rows = buildRacerRaceHistoryRows({
  entries: [
    { race_id: R[0], boat_number: 2 },
    { race_id: R[1], boat_number: 1 },
    { race_id: R[2], boat_number: 3 },
    { race_id: R[3], boat_number: 1 },
  ],
  raceRows: [
    { race_id: R[0], venue_code: 1, race_grade: "ippan" },
    { race_id: R[1], venue_code: 1, race_grade: null },
    { race_id: R[2], venue_code: null },
    { race_id: R[3], venue_code: 2, race_grade: "G1" },
  ],
  // R[3] は不成立（race_status=no_race、使えない結果）
  resultRows: [
    result(R[0]),
    result(R[1], { rank1: 3, rank2: 2, rank3: 4 }),
    result(R[2]),
    result(R[3], { race_status: "no_race" }),
  ],
  exhibitionRows: [{ race_id: R[0], boat_number: 2, exhibition_time: 6.71 }],
  conditionRows: [
    {
      race_id: R[0],
      race_stage: "予選",
      race_title: "x杯",
      weather: "晴",
      wind_speed: 5,
      wave_height: 3,
    },
  ],
  stRows: [
    {
      race_id: R[0],
      boat_number: 1,
      start_timing: 0.1,
      is_flying: false,
      finish_mark: "1",
      entry_course: 1,
    },
    {
      race_id: R[0],
      boat_number: 2,
      start_timing: 0.15,
      is_flying: false,
      finish_mark: "2",
      entry_course: null,
    },
    {
      race_id: R[0],
      boat_number: 3,
      start_timing: 0.02,
      is_flying: true,
      finish_mark: "F",
      entry_course: 3,
    },
    {
      race_id: R[1],
      boat_number: 1,
      start_timing: null,
      is_flying: false,
      finish_mark: "転",
      entry_course: 1,
    },
  ],
});
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

console.log("verify-full-picture-screen-shared: OK");
