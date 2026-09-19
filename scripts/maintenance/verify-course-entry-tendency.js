#!/usr/bin/env node
/**
 * 進入コース傾向の集計ロジック（scripts/lib/courseEntryTendency.js、BOA-284）の
 * 回帰テスト。DB接続は不要。
 *
 * 特に、actual_course_Nの添字が「艇番」（値=進入コース）であることの確認が主目的。
 * 旧列course_1〜6（添字=コース、値=艇番）と同じ「値が艇番と一致する列を探す」
 * 読み方をすると、3艇以上が入れ替わるケースで誤った値になる。
 */
import {
  actualCourseOf,
  buildCourseEntryTendency,
  isShiftedByAbsence,
} from "../lib/courseEntryTendency.js";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

const result = (courses) => ({
  actual_course_1: courses[0] ?? null,
  actual_course_2: courses[1] ?? null,
  actual_course_3: courses[2] ?? null,
  actual_course_4: courses[3] ?? null,
  actual_course_5: courses[4] ?? null,
  actual_course_6: courses[5] ?? null,
});

// 枠なり
check(
  "枠なり: 3号艇は3コース",
  actualCourseOf(result([1, 2, 3, 4, 5, 6]), 3),
  3,
);

// 1号艇→2コース、2号艇→3コース、3号艇→1コース（3艇の循環）
const cycle = result([2, 3, 1, 4, 5, 6]);
check("循環: 1号艇は2コース", actualCourseOf(cycle, 1), 2);
check("循環: 2号艇は3コース", actualCourseOf(cycle, 2), 3);
check("循環: 3号艇は1コース", actualCourseOf(cycle, 3), 1);

// 欠場（Kファイルに進入コースが無い）はnull
check(
  "欠場: 4号艇はnull",
  actualCourseOf(result([1, 2, 3, null, 5, 6]), 4),
  null,
);
check("結果行が無い場合はnull", actualCourseOf(undefined, 1), null);
check("範囲外の値はnull", actualCourseOf(result([9, 2, 3, 4, 5, 6]), 1), null);

// 欠場による繰り上がり（1号艇欠場で2号艇が1コースに入る等）
const shifted = result([null, 1, 2, 3, 4, 5]);
check("繰り上がり: 2号艇は内側(1号艇)欠場で該当", isShiftedByAbsence(shifted, 2), true);
check("繰り上がり: 6号艇も該当", isShiftedByAbsence(shifted, 6), true);
check("繰り上がり: 1号艇自身は該当しない", isShiftedByAbsence(shifted, 1), false);
const outerAbsent = result([1, 2, 3, 4, 5, null]);
check(
  "外側(6号艇)の欠場は内側の艇に影響しない",
  isShiftedByAbsence(outerAbsent, 5),
  false,
);
check(
  "前づけ(欠場なし)は繰り上がりでない",
  isShiftedByAbsence(result([1, 2, 3, 6, 4, 5]), 4),
  false,
);

// 集計
const results = new Map([
  ["2026-09-10-08-01", result([1, 2, 3, 4, 5, 6])],
  ["2026-09-11-08-02", result([1, 2, 3, 6, 4, 5])], // 4号艇は6コース
  ["2026-09-12-10-03", result([1, 2, 3, 4, 5, 6])],
  ["2025-01-01-08-04", result([1, 2, 3, 4, 5, 6])], // 集計期間外
  ["2026-09-13-08-05", result([1, 2, 3, null, 5, 6])], // 4号艇は欠場
  ["2026-09-15-08-07", result([1, 2, null, 3, 5, 6])], // 3号艇欠場→4号艇は3コースへ繰り上がり
]);
const entries = [
  { race_id: "2026-09-10-08-01", boat_number: 4 },
  { race_id: "2026-09-11-08-02", boat_number: 4 },
  { race_id: "2026-09-12-10-03", boat_number: 4 },
  { race_id: "2025-01-01-08-04", boat_number: 4 },
  { race_id: "2026-09-13-08-05", boat_number: 4 },
  { race_id: "2026-09-14-08-06", boat_number: 4 }, // 結果行が無い
  { race_id: "2026-09-15-08-07", boat_number: 4 }, // 内側欠場による繰り上がり
];
check(
  "集計: 全体・会場別、期間外/欠場/結果なし/繰り上がりは除外",
  buildCourseEntryTendency(entries, results, "2025-09-19"),
  {
    since: "2025-09-19",
    all: { 4: { n: 3, courses: { 4: 2, 6: 1 } } },
    venues: {
      8: { 4: { n: 2, courses: { 4: 1, 6: 1 } } },
      10: { 4: { n: 1, courses: { 4: 1 } } },
    },
  },
);
check(
  "集計対象が無ければnull",
  buildCourseEntryTendency([], new Map(), "2025-09-19"),
  null,
);
check(
  "1走だけでもnullにしない（走数の下限は表示側の責務）",
  buildCourseEntryTendency([entries[0]], results, "2025-09-19")?.all,
  { 4: { n: 1, courses: { 4: 1 } } },
);

console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
