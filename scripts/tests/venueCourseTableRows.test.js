// 実行: node --test scripts/tests/venueCourseTableRows.test.js（BOA-1687）
import { test } from "node:test";
import assert from "node:assert/strict";
import { VENUE_SUMMARY_STATS } from "../../src/data/venueSummaryStats.js";
import { venueCourseTableRows } from "../../src/pure/venueCourseTableRows.js";

const { venues, national } = VENUE_SUMMARY_STATS;

test("24場すべてで6行・率は0〜100・1着の回数は母数以下", () => {
  for (let code = 1; code <= 24; code++) {
    const venue = venues[code];
    const rows = venueCourseTableRows(venue, national);
    assert.ok(rows, `会場 ${code} の行が無い`);
    assert.deepEqual(
      rows.map((r) => r.course),
      [1, 2, 3, 4, 5, 6],
      `会場 ${code}`,
    );
    for (const r of rows) {
      assert.ok(
        r.rate >= 0 && r.rate <= 100,
        `会場 ${code} ${r.course}コース ${r.rate}`,
      );
      assert.ok(r.nationalRate >= 0 && r.nationalRate <= 100);
      assert.ok(r.wins >= 0 && r.wins <= venue.courseRaces);
    }
  }
});

test("母数が0・会場の値が無いときは節ごと出さない（null）", () => {
  assert.equal(
    venueCourseTableRows({ ...venues[1], courseRaces: 0 }, national),
    null,
  );
  assert.equal(venueCourseTableRows(undefined, national), null);
});
