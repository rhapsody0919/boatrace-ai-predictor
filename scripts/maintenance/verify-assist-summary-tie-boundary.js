/**
 * BOA-838: formSummary の上位の境目にある同数の組を黙って落とさない。
 * 表示は上限（2連単5・3連単3）までで切り、境目と同じ件数の組が後ろに残るときは
 * その数（exactaTies・trifectaTies）を返す（2026-10-13 オーケストレーター決定）。
 * 実行: node scripts/maintenance/verify-assist-summary-tie-boundary.js
 * verify-registry.json に ci で登録済み。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formSummary } from "../../src/utils/assistSummary.js";
import { ASSIST_COPY } from "../../src/data/thinkingAssistCopy.js";

const summary = (tri) => formSummary({
  cells: { waku: { forms: { d2: {
    n: Object.values(tri).reduce((sum, count) => sum + count, 0),
    first_boat: [0, 0, 0, 0, 0, 0],
    tri,
  } } } },
}, "d2");
const rows = (entries) => entries.map(([key, count]) => [key.split("-").map(Number), count]);

test("2連単: 上位5までで切り、5位と同数で切った組の数を返す", () => {
  const result = summary({
    "2-6-1": 10, "1-5-2": 10, "1-2-3": 6, "1-2-4": 4,
    "3-1-2": 50, "3-2-1": 40, "4-1-2": 30, "4-2-1": 20,
    "5-1-2": 9,
  });
  assert.deepEqual(result.topExacta, rows([
    ["3-1", 50], ["3-2", 40], ["4-1", 30], ["4-2", 20], ["1-2", 10],
  ]));
  // 1-5・2-6 も10件。件数が下の 5-1（9件）は数えない
  assert.deepEqual(result.exactaTies, { n: 2, k: 10 });
});

test("3連単: 上位3までで切り、3位と同数で切った組の数を返す", () => {
  const result = summary({
    "2-6-1": 10, "1-5-2": 10, "1-2-3": 10,
    "3-1-2": 50, "3-2-1": 40, "5-1-2": 9,
  });
  assert.deepEqual(result.topTrifecta, rows([
    ["3-1-2", 50], ["3-2-1", 40], ["1-2-3", 10],
  ]));
  assert.deepEqual(result.trifectaTies, { n: 2, k: 10 });
});

test("境目に同数がなければ従来の上限で、残りの数は null", () => {
  const result = summary({
    "1-2-3": 60, "1-3-2": 50, "1-4-2": 40,
    "1-5-2": 30, "1-6-2": 20, "2-1-3": 10,
  });
  assert.equal(result.topExacta.length, 5);
  assert.equal(result.topTrifecta.length, 3);
  assert.equal(result.exactaTies, null);
  assert.equal(result.trifectaTies, null);
});

test("全組同数・上限未満・空の出目・セル欠落", () => {
  const entries = ["2-1-3", "1-6-2", "1-5-2", "1-4-2", "1-3-2", "1-2-3"];
  const result = summary(Object.fromEntries(entries.map((key) => [key, 10])));
  // 十数組並ばないよう、上限で切って残りは数だけ
  assert.deepEqual(result.topTrifecta, rows(entries.toSorted().slice(0, 3).map((key) => [key, 10])));
  assert.deepEqual(result.trifectaTies, { n: 3, k: 10 });
  assert.equal(result.topExacta.length, 5);
  assert.deepEqual(result.exactaTies, { n: 1, k: 10 });
  const short = summary({ "1-2-3": 10 });
  assert.deepEqual(short.topExacta, rows([["1-2", 10]]));
  assert.deepEqual(short.topTrifecta, rows([["1-2-3", 10]]));
  assert.equal(short.exactaTies, null);
  assert.equal(short.trifectaTies, null);
  const empty = formSummary({ cells: { waku: { forms: { d2: { n: 30, tri: {} } } } } }, "d2");
  assert.deepEqual(empty.topExacta, []);
  assert.deepEqual(empty.topTrifecta, []);
  assert.equal(empty.exactaTies, null);
  assert.equal(formSummary(null, "d2"), null);
  assert.equal(summary({}), null);
});

test("文言: 同じk件の組がほかにn組", () => {
  assert.equal(ASSIST_COPY.comboTiesMore({ n: 2, k: 10 }), "同じ10件の組がほかに2組");
});
