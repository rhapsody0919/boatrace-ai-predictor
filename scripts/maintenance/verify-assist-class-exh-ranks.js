/** BOA-1114: 思考アシストの級の艇数・展示タイム順位・STの補い・合成オッズ表記。 */
import assert from "node:assert/strict";
import {
  restClassCounts,
  exhRanks,
  courseFilled,
  compositeText,
  MIN_COURSE_RUNS,
} from "../../src/utils/assistModel.js";

let failures = 0;
let checks = 0;
function check(name, actual, expected) {
  checks++;
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`OK: ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}\n${error.message}`);
  }
}

const classes = ["A1", "A1", "A2", "A2", "B1", "B2"];
const restOfOne = "A1 が1艇・A2 が2艇・B1 が1艇・B2 が1艇";
check("restClassCounts: 1号艇を除外・級順・単位・区切り", restClassCounts(classes, 1), restOfOne);
check("restClassCounts: 固定艇の省略は1号艇", restClassCounts(classes), restOfOne);
check("restClassCounts: 3号艇を除外", restClassCounts(classes, 3), "A1 が2艇・A2 が1艇・B1 が1艇・B2 が1艇");
check("restClassCounts: 0艇の級は省略", restClassCounts(["B1", "A1", "A1", "A1", "A1", "A1"], 1), "A1 が5艇");
check("restClassCounts: 固定艇だけ欠損", restClassCounts([null, "A1", "A2", "A2", "B1", "B2"], 1), restOfOne);
check("restClassCounts: 残り艇の級が欠損", restClassCounts(["A1", null, "A2", "A2", "B1", "B2"], 1), null);
check("restClassCounts: 6艇でない", restClassCounts(["A1", "A2"], 1), null);
check("restClassCounts: 配列なし", restClassCounts(null, 1), null);

for (const [name, times, expected] of [
  ["同タイムはmin順位・欠損はnull", [6.72, 6.80, 6.72, 6.90, null, 6.65], [2, 4, 2, 5, null, 1]],
  ["全艇同タイム", [6.7, 6.7, 6.7], [1, 1, 1]],
  ["undefinedは欠損", [6.7, undefined], [1, null]],
  ["全艇欠損", [null], [null]],
  ["空配列", [], []],
]) {
  check(`exhRanks: ${name}`, exhRanks(times.map((exhTime) => ({ exhTime }))), expected);
}

check("MIN_COURSE_RUNS: 5走", MIN_COURSE_RUNS, 5);
const courseSt = {
  course_n: [3, 5, null, 0, 10, 4],
  course_filled: [0.15, 0.16, 0.17, null, 0.12, 0],
};
for (const [i, expected] of [true, false, true, false, false, true, false].entries()) {
  check(`courseFilled: i=${i}（5走境界・欠損・0・範囲外）`, courseFilled(courseSt, i), expected);
}
check("courseFilled: courseStなし", courseFilled(null, 0), false);
check("courseFilled: 空オブジェクト", courseFilled({}, 0), false);
check("courseFilled: course_nなしで補った値あり", courseFilled({ course_filled: [0.1] }, 0), true);

for (const [v, expected] of [
  [null, null], [undefined, null], [3.456, "3.46"],
  [3.454, "3.45"], [12, "12.00"], [0, "0.00"],
]) {
  check(`compositeText: ${String(v)}`, compositeText(v), expected);
}

// 仕様未定。現在値を観測するだけで、期待値として固定しない。
const KNOWN_GAPS = [
  {
    input: 'restClassCounts(["A1","A1","A2","A2","B1","X"], 1)',
    specification: "4級に無い級の扱いはJSDocに無い",
    current: () => restClassCounts(["A1", "A1", "A2", "A2", "B1", "X"], 1),
  },
  {
    input: 'restClassCounts(["A1","A1","A2","A2","B1","B2"], 7)',
    specification: "1〜6の外の固定艇の扱いはJSDocに無い",
    current: () => restClassCounts(classes, 7),
  },
  {
    input: "exhRanks([{exhTime: 0}, {exhTime: 6.7}])",
    specification: "0の扱いはJSDocに無い（パーサーは0をnullにする）",
    current: () => exhRanks([{ exhTime: 0 }, { exhTime: 6.7 }]),
  },
  ...[1.005, 2.675].map((v) => ({
    input: `compositeText(${v})`,
    specification: "小数2桁の丸め方は未定（toFixedの2進丸め）",
    current: () => compositeText(v),
  })),
];
console.log(`\nKNOWN_GAPS: ${KNOWN_GAPS.length}件（assert対象外）`);
for (const { input, specification, current } of KNOWN_GAPS) {
  console.log(JSON.stringify({ input, specification, current: current() }));
}
console.log(`\n${checks}件の検証、${failures}件の失敗`);
if (failures > 0) process.exitCode = 1;
