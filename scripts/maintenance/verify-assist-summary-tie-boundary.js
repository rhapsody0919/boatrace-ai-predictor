/**
 * BOA-838: formSummary の上位の境目にある同数の組をすべて残す。
 * 実行: node scripts/maintenance/verify-assist-summary-tie-boundary.js
 * verify-registry.json への登録が必要（取り込みレーンが行う）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formSummary } from "../../src/utils/assistSummary.js";

const summary = (tri) => formSummary({
  cells: { waku: { forms: { d2: {
    n: Object.values(tri).reduce((sum, count) => sum + count, 0),
    first_boat: [0, 0, 0, 0, 0, 0],
    tri,
  } } } },
}, "d2");
const rows = (entries) => entries.map(([key, count]) => [key.split("-").map(Number), count]);

test("2連単: 5位の同数をすべて残し、件数が下の組を除く", () => {
  const result = summary({
    "2-6-1": 10, "1-5-2": 10, "1-2-3": 6, "1-2-4": 4,
    "3-1-2": 50, "3-2-1": 40, "4-1-2": 30, "4-2-1": 20,
    "5-1-2": 9,
  });
  assert.deepEqual(result.topExacta, rows([
    ["3-1", 50], ["3-2", 40], ["4-1", 30], ["4-2", 20],
    ["1-2", 10], ["1-5", 10], ["2-6", 10],
  ]));
});

test("3連単: 3位の同数をすべて残し、件数が下の組を除く", () => {
  assert.deepEqual(summary({
    "2-6-1": 10, "1-5-2": 10, "1-2-3": 10,
    "3-1-2": 50, "3-2-1": 40, "5-1-2": 9,
  }).topTrifecta, rows([
    ["3-1-2", 50], ["3-2-1", 40],
    ["1-2-3", 10], ["1-5-2", 10], ["2-6-1", 10],
  ]));
});

test("境目に同数がなければ従来の上限を保つ", () => {
  const result = summary({
    "1-2-3": 60, "1-3-2": 50, "1-4-2": 40,
    "1-5-2": 30, "1-6-2": 20, "2-1-3": 10,
  });
  assert.equal(result.topExacta.length, 5);
  assert.equal(result.topTrifecta.length, 3);
});

test("全組同数・上限未満・空の出目・セル欠落", () => {
  const entries = ["2-1-3", "1-6-2", "1-5-2", "1-4-2", "1-3-2", "1-2-3"];
  const result = summary(Object.fromEntries(entries.map((key) => [key, 10])));
  assert.deepEqual(result.topTrifecta, rows(entries.toSorted().map((key) => [key, 10])));
  assert.equal(result.topExacta.length, 6);
  const short = summary({ "1-2-3": 10 });
  assert.deepEqual(short.topExacta, rows([["1-2", 10]]));
  assert.deepEqual(short.topTrifecta, rows([["1-2-3", 10]]));
  const empty = formSummary({ cells: { waku: { forms: { d2: { n: 30, tri: {} } } } } }, "d2");
  assert.deepEqual(empty.topExacta, []);
  assert.deepEqual(empty.topTrifecta, []);
  assert.equal(formSummary(null, "d2"), null);
  assert.equal(summary({}), null);
});
