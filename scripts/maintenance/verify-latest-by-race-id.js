#!/usr/bin/env node
/** latestByRaceId の JSDoc の仕様を固定する（BOA-1041）。 */
import assert from "node:assert/strict";
import { latestByRaceId } from "../lib/latestByRaceId.js";

// 仕様と実装が食い違う入力は assert せず、ここに両者の値と入力を残す。
const KNOWN_GAPS = [];
const rows = [
  { race_id: "a", captured_at: "2026-10-24T01:00:00Z", value: "v1" },
  { race_id: "a", captured_at: "2026-10-24T03:00:00Z", value: "v2" },
  { race_id: "a", captured_at: "2026-10-24T03:00:00Z", value: "v3" },
  { race_id: "b", captured_at: "2026-10-24T00:00:00Z", value: "v4" },
];

// 仕様の値: JSDoc の最大時刻・同値なら先の行。実装の値は各 run 内で取得。
const specification = {
  values: [["a", "v2"], ["b", "v4"]],
  timestamps: [
    ["a", "2026-10-24T03:00:00Z"],
    ["b", "2026-10-24T00:00:00Z"],
  ],
  custom: [[1, { id: 1, ts: 5 }]],
  empty: [],
};

const tests = [
  ["最新行と同時刻の先行行を保持", () => {
    const actual = latestByRaceId(rows);
    assert.ok(actual instanceof Map);
    assert.equal(actual.size, 2);
    assert.deepEqual(
      [...actual].map(([id, row]) => [id, row.value]),
      specification.values,
    );
    assert.strictEqual(actual.get("a"), rows[1]);
    assert.strictEqual(actual.get("b"), rows[3]);
  }],
  ["逆順と混在順でも各IDの最新時刻は同じ", () => {
    for (const input of [
      [...rows].reverse(),
      [rows[2], rows[3], rows[0], rows[1]],
    ]) {
      const actual = latestByRaceId(input);
      assert.ok(actual instanceof Map);
      assert.equal(actual.size, 2);
      assert.deepEqual(
        [...actual].map(([id, row]) => [id, row.captured_at]).sort(),
        specification.timestamps,
      );
    }
  }],
  ["フィールド指定と数値ID・時刻", () => {
    const actual = latestByRaceId([{ id: 1, ts: 2 }, { id: 1, ts: 5 }], {
      idField: "id", tsField: "ts",
    });
    assert.ok(actual instanceof Map);
    assert.deepEqual([...actual], specification.custom);
  }],
  ["空配列は空のMap", () => {
    const actual = latestByRaceId([]);
    assert.ok(actual instanceof Map);
    assert.equal(actual.size, 0);
    assert.deepEqual([...actual], specification.empty);
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`OK: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`NG: ${name}`, error);
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, KNOWN_GAPS);
if (failed > 0) process.exitCode = 1;
