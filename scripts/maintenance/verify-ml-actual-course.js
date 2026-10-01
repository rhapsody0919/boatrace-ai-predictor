/**
 * verify-ml-actual-course.js - ML学習データ（scripts/ml/export-training-data.js）の actual_course が、
 * 枠番ではなく実際の進入コースになっていることの検証（BOA-631）。DBには接続しない。
 *
 * 確認すること:
 *   - race_start_timings.entry_course を最優先に使う
 *   - 無ければ race_results.actual_course_<艇番>（Kファイル由来）
 *   - どちらも無ければ null。race_results.course_1〜6（枠番と恒等の無効な列）や枠番で代用しない
 */
import { resolveActualCourse } from "../ml/export-training-data.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 前付け（4号艇が2コース）。course_1〜6 は枠番と恒等（実データの状態）
const identityCourses = {
  course_1: 1,
  course_2: 2,
  course_3: 3,
  course_4: 4,
  course_5: 5,
  course_6: 6,
};

check(
  "entry_course があればそれを使う（4号艇が2コースに入った前付け）",
  resolveActualCourse({
    entryCourse: 2,
    result: { ...identityCourses, actual_course_4: 3 },
    boatNumber: 4,
  }) === 2,
);
check(
  "entry_course が無ければ actual_course_<艇番>（Kファイル由来）",
  resolveActualCourse({
    entryCourse: null,
    result: { ...identityCourses, actual_course_4: 2 },
    boatNumber: 4,
  }) === 2,
);
check(
  "どちらも無ければ null。course_1〜6・枠番で代用しない（以前はここで枠番の4になっていた）",
  resolveActualCourse({
    entryCourse: undefined,
    result: identityCourses,
    boatNumber: 4,
  }) === null,
);
check(
  "範囲外・非整数の値は無効として次の候補へ（entry_course=0 → actual_course_4=5）",
  resolveActualCourse({
    entryCourse: 0,
    result: { actual_course_4: 5 },
    boatNumber: 4,
  }) === 5 &&
    resolveActualCourse({
      entryCourse: 7,
      result: { actual_course_4: 1.5 },
      boatNumber: 4,
    }) === null,
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
