#!/usr/bin/env node
/**
 * race_conditions の race_title・is_final_day を race_series から埋める候補の作り方（BOA-695）を検証する。
 *
 * scripts/maintenance/backfill-race-series-meta.js の planFinalTitle（純粋関数）だけを見る。DBには接続しない。
 *
 *   node scripts/maintenance/verify-race-series-final-title.js
 */
import assert from "node:assert/strict";
import { planFinalTitle } from "./backfill-race-series-meta.js";

// 会場12（住之江）: 12/1〜12/6 の節。会場3: 同じ日に重なる2節（データ不整合）
const byVenue = new Map([
  [
    12,
    [
      {
        start_date: "2025-12-01",
        end_date: "2025-12-06",
        title: "住之江の一般戦",
      },
      { start_date: "2025-12-08", end_date: "2025-12-10", title: null },
    ],
  ],
  [
    3,
    [
      { start_date: "2025-12-01", end_date: "2025-12-04", title: "A" },
      { start_date: "2025-12-03", end_date: "2025-12-05", title: "B" },
    ],
  ],
]);
const races = [
  { race_id: "2025-12-02-12-01", venue_code: 12, race_date: "2025-12-02" },
  { race_id: "2025-12-06-12-12", venue_code: 12, race_date: "2025-12-06" },
  { race_id: "2025-12-05-12-01", venue_code: 12, race_date: "2025-12-05" },
  { race_id: "2025-12-07-12-01", venue_code: 12, race_date: "2025-12-07" },
  { race_id: "2025-12-03-03-01", venue_code: 3, race_date: "2025-12-03" },
  { race_id: "2025-12-09-12-01", venue_code: 12, race_date: "2025-12-09" },
];

const conds = [
  // 1. 両方 NULL・節の途中 → タイトルと false
  { race_id: "2025-12-02-12-01", race_title: null, is_final_day: null },
  // 2. 両方 NULL・節の最終日 → タイトルと true
  { race_id: "2025-12-06-12-12", race_title: null, is_final_day: null },
  // 3. タイトルだけ既存値あり → タイトルは既存値のまま、is_final_day だけ埋める
  {
    race_id: "2025-12-05-12-01",
    race_title: "既存のタイトル",
    is_final_day: null,
  },
  // 4. 節の外（節の間の日）→ unmatched
  { race_id: "2025-12-07-12-01", race_title: null, is_final_day: null },
  // 5. 2節に重なる → ambiguous
  { race_id: "2025-12-03-03-01", race_title: null, is_final_day: null },
  // 6. races に無い → 対象範囲外
  { race_id: "2025-12-02-12-02", race_title: null, is_final_day: null },
  // 7. 節のタイトルが NULL で is_final_day は既存値あり → 埋める値なし
  { race_id: "2025-12-09-12-01", race_title: null, is_final_day: false },
];

const { updates, counts } = planFinalTitle(conds, races, byVenue);
const byId = new Map(updates.map((u) => [u.race_id, u]));

const checks = [
  [
    "節の途中は race_title を埋め、is_final_day=false",
    () =>
      assert.deepEqual(byId.get("2025-12-02-12-01"), {
        race_id: "2025-12-02-12-01",
        race_title: "住之江の一般戦",
        is_final_day: false,
      }),
  ],
  [
    "節の最終日（race_date = end_date）は is_final_day=true",
    () => assert.equal(byId.get("2025-12-06-12-12").is_final_day, true),
  ],
  [
    "既存の race_title は上書きしない（同じ値を渡し直す）",
    () =>
      assert.deepEqual(byId.get("2025-12-05-12-01"), {
        race_id: "2025-12-05-12-01",
        race_title: "既存のタイトル",
        is_final_day: false,
      }),
  ],
  [
    "節の外・2節に重なる・races に無い・埋める値なしは書かない",
    () => {
      for (const id of [
        "2025-12-07-12-01",
        "2025-12-03-03-01",
        "2025-12-02-12-02",
        "2025-12-09-12-01",
      ]) {
        assert.equal(byId.has(id), false, id);
      }
    },
  ],
  [
    "全行が race_id・race_title・is_final_day の3列をそろえて持つ（バルク upsert で欠けた列を NULL にしない）",
    () => {
      for (const u of updates) {
        assert.deepEqual(Object.keys(u).sort(), [
          "is_final_day",
          "race_id",
          "race_title",
        ]);
      }
    },
  ],
  [
    "件数",
    () =>
      assert.deepEqual(counts, {
        title: 2,
        final: 3,
        finalTrue: 1,
        unmatched: 1,
        ambiguous: 1,
        outOfRange: 1,
        nothingToFill: 1,
      }),
  ],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[NG] ${name}: ${error.message}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通りました");
