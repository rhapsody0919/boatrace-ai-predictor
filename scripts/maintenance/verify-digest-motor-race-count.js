#!/usr/bin/env node
/**
 * 「本日のデータ一覧」の行に付ける会場公式のモーター出走数（motor_race_count、BOA-702）の付け方を検証する。
 *
 * scripts/daily/generate-morning-digest.js の attachMotorRaceCounts（純粋関数）だけを見る。DBには接続しない。
 *
 *   node scripts/maintenance/verify-digest-motor-race-count.js
 */
import assert from "node:assert/strict";
import { attachMotorRaceCounts } from "../daily/generate-morning-digest.js";

const entries = [
  { race_id: "2026-10-04-23-08", boat_number: 3, motor_number: 65 },
  { race_id: "2026-10-04-23-08", boat_number: 1, motor_number: 12 },
  { race_id: "2026-10-04-15-09", boat_number: 1, motor_number: 65 },
  { race_id: "2026-10-04-23-02", boat_number: 4, motor_number: null },
];
// 会場23のモーター65は出走数0、会場23のモーター12は5。会場15のモーター65はスナップショットなし（キーなし）。
// 会場23のモーター40はスナップショットはあるが出走数の列が空（null）
const counts = new Map([
  ["23|65", 0],
  ["23|12", 5],
  ["23|40", null],
]);

const row = (over) => ({
  section: "nige",
  race_id: "2026-10-04-23-08",
  venue_code: 23,
  boat_number: 3,
  motor_2rate: 0,
  ...over,
});

const cases = [
  ["未使用の新モーター（出走数0）", row({}), 0],
  [
    "使われたモーター（出走数5）",
    row({ boat_number: 1, motor_2rate: 31.2 }),
    5,
  ],
  // 同じモーター番号でも会場が違えば別のモーター。会場15のスナップショットは無い
  [
    "会場が違う同じ番号のモーターを取り違えない",
    row({ race_id: "2026-10-04-15-09", venue_code: 15, boat_number: 1 }),
    null,
  ],
  [
    "モーター番号が分からない行は NULL",
    row({ race_id: "2026-10-04-23-02", boat_number: 4 }),
    null,
  ],
  [
    "出走表に無い艇は NULL",
    row({ race_id: "2026-10-04-23-99", boat_number: 2 }),
    null,
  ],
  // フライング・帰郷の行は motor_2rate が NULL（2連率を出さない）なので、出走数も付けない
  [
    "2連率の無い行（フライング）は NULL",
    row({ section: "flying", motor_2rate: null }),
    null,
  ],
  [
    "帰郷の行（race_id・枠番が NULL）は NULL",
    row({
      section: "returned",
      race_id: null,
      boat_number: null,
      motor_2rate: null,
    }),
    null,
  ],
];

const out = attachMotorRaceCounts(
  cases.map(([, r]) => r),
  entries,
  counts,
);

let failed = 0;
cases.forEach(([name, , expected], i) => {
  try {
    assert.equal(out[i].motor_race_count, expected);
    // 全行に同じキーを持たせる（バルク INSERT で行ごとにキーの集合を変えない）
    assert.ok(Object.hasOwn(out[i], "motor_race_count"));
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[NG] ${name}: ${error.message}`);
  }
});

// 元の行を書き換えない
assert.equal(Object.hasOwn(cases[0][1], "motor_race_count"), false);

if (failed > 0) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通りました");
