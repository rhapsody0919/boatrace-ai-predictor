#!/usr/bin/env node
/**
 * verify-racer-entry-course-filter.js - 選手ページの絞り込み「進入コース」が、実際に入ったコース（entryCourse）だけで絞り、進入が分からない走を数えないことを守る。
 * 選択肢の走数は、ほかの絞り込み（会場・枠番・グレード・レース種別）に合う走だけで数える。純関数 src/pure/racerEntryCourseFilter.js を照らす。
 */
import assert from "node:assert/strict";
import {
  entryCourseCounts,
  filterByEntryCourse,
  firstEntryCourseDate,
} from "../../src/pure/racerEntryCourseFilter.js";

const row = (o) => ({
  venueCode: 8,
  boatNumber: 1,
  raceGrade: "一般",
  raceStage: null,
  entryCourse: 1,
  ...o,
});

const history = [
  row({}),
  // 前付けで6号艇が1コースに入った走（艇番とコースが違う）
  row({ boatNumber: 6, entryCourse: 1 }),
  row({ boatNumber: 2, entryCourse: 2, venueCode: 12 }),
  // 進入が分からない走はどのコースにも入れない
  row({ boatNumber: 3, entryCourse: null }),
  row({ boatNumber: 4, entryCourse: 4, raceGrade: "G1", raceStage: "優勝戦" }),
];

// 絞り込みなしはそのまま返す（null もそのまま）
assert.equal(filterByEntryCourse(history, "all"), history);
assert.equal(filterByEntryCourse(null, "1"), null);

// 文字列の値（select の value）で絞る。艇番ではなく進入コースで見る
assert.deepEqual(
  filterByEntryCourse(history, "1").map((r) => r.boatNumber),
  [1, 6],
);
assert.equal(filterByEntryCourse(history, "3").length, 0);

const all = { venue: "all", boat: "all", grade: "all", stage: "all" };
assert.deepEqual(entryCourseCounts(history, all), {
  1: 2,
  2: 1,
  3: 0,
  4: 1,
  5: 0,
  6: 0,
});
// 枠番と重ねると、6号艇の1コースは前付けの1走だけ
assert.deepEqual(entryCourseCounts(history, { ...all, boat: "6" }), {
  1: 1,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
});
// 会場・グレード・レース種別も効く
assert.equal(entryCourseCounts(history, { ...all, venue: "12" })[2], 1);
assert.equal(entryCourseCounts(history, { ...all, venue: "12" })[1], 0);
assert.equal(
  entryCourseCounts(history, { ...all, grade: "G1", stage: "優勝戦" })[4],
  1,
);
assert.deepEqual(Object.values(entryCourseCounts(null, all)), [0, 0, 0, 0, 0, 0]);

// 注記の始まりの日は、進入が分かった走のうち一番古い日（固定の日を書かない。取り込みで延びたらそれに合う）
assert.equal(
  firstEntryCourseDate([
    { raceId: "2026-01-05-08-01", entryCourse: 2 },
    { raceId: "2025-12-03-12-01", entryCourse: null },
    { raceId: "2025-12-06-12-01", entryCourse: 1 },
  ]),
  "2025-12-06",
);
assert.equal(firstEntryCourseDate([{ raceId: "2026-01-05-08-01", entryCourse: null }]), null);
assert.equal(firstEntryCourseDate(null), null);

console.log("OK: 進入コースの絞り込みと選択肢の走数・注記の始まりの日");
