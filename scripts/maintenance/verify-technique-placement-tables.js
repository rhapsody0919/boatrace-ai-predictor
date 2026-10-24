#!/usr/bin/env node
/**
 * BOA-1066: 決まり手・着順の既定表とフォールバックの契約。通信・DB不要。
 * 根拠: winningTechniques.js の JSDoc、placementDistribution.js の
 * 30件の閾値・件数加重平均・小数3桁丸め・勝者除外と再正規化のコメント。
 * 表の各数値の正否や、実測の母集団を検証するものではない。
 */
import assert from "node:assert/strict";
import {
  TECHNIQUES,
  TECHNIQUE_NAMES,
  COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE,
  toTechniqueKey,
  getDefaultDistribution,
} from "../lib/winningTechniques.js";
import {
  PLACEMENT_DISTRIBUTION,
  getPlacementBaseline,
} from "../lib/placementDistribution.js";

// 仕様と実値が食い違う入力は assert せず、入力・仕様の値・今の値をここに残す。
const KNOWN_GAPS = [];
const courses = [1, 2, 3, 4, 5, 6];
const courseKeys = courses.map(String);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const round3 = (value) => Math.round(value * 1000) / 1000;
let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`OK ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
function probabilityTable(table, tolerance) {
  const values = Object.values(table);
  assert.ok(values.length > 0);
  assert.ok(values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  assert.ok(Math.abs(sum(values) - 1) <= tolerance + 1e-12);
}
function placements(entry, winner) {
  for (const rank of ["second", "third"]) {
    assert.deepEqual(Object.keys(entry[rank]), courseKeys);
    assert.equal(entry[rank][winner], 0);
    probabilityTable(entry[rank], 0.003);
  }
}

// コメントの式を列単位で評価する独立の期待値。件数で加重し、3桁丸めの後に
// 勝者を除き、残った確率で条件づけて再び3桁に丸める。
function weightedExpectation(entries, winner) {
  const sampleSize = sum(entries.map((entry) => entry.sampleSize));
  const expected = { sampleSize };
  for (const rank of ["second", "third"]) {
    const means = courses.map((course) => round3(sum(entries.map(
      (entry) => entry[rank][course] * entry.sampleSize,
    )) / sampleSize));
    means[winner - 1] = 0;
    const total = sum(means);
    expected[rank] = Object.fromEntries(courses.map((course, i) => [
      course, round3(means[i] / total),
    ]));
  }
  return expected;
}
const before = JSON.stringify([
  TECHNIQUES, TECHNIQUE_NAMES, COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE, PLACEMENT_DISTRIBUTION,
]);

test("決まり手6種の変換と逆写像", () => {
  const expected = {
    逃げ: "nige", 差し: "sashi", まくり: "makuri",
    まくり差し: "makurizashi", 抜き: "nuki", 恵まれ: "megumare",
  };
  assert.deepEqual(TECHNIQUES, expected);
  assert.equal(Object.keys(TECHNIQUE_NAMES).length, 6);
  for (const [name, key] of Object.entries(expected)) {
    assert.equal(toTechniqueKey(name), key);
    assert.equal(TECHNIQUE_NAMES[key], name);
  }
  assert.equal(toTechniqueKey("知らない名前"), null);
});

test("既定分布の取得と範囲外", () => {
  assert.equal(getDefaultDistribution(1).nige, 0.954);
  for (const course of courses) {
    assert.deepEqual(getDefaultDistribution(course), COURSE_DEFAULT_DISTRIBUTION[course]);
  }
  assert.deepEqual(getDefaultDistribution(0), {});
  assert.deepEqual(getDefaultDistribution(7), {});
});

test("攻撃・被攻撃の全6コースは既知キーの確率分布", () => {
  for (const table of [COURSE_DEFAULT_DISTRIBUTION, COURSE_DEFAULT_DEFENSE]) {
    assert.deepEqual(Object.keys(table), courseKeys);
    for (const distribution of Object.values(table)) {
      assert.ok(Object.keys(distribution).every((key) => Object.hasOwn(TECHNIQUE_NAMES, key)));
      probabilityTable(distribution, 0.002);
    }
  }
});

test("着順表21組の勝者除外と確率合計", () => {
  assert.equal(Object.keys(PLACEMENT_DISTRIBUTION).length, 21);
  for (const [key, entry] of Object.entries(PLACEMENT_DISTRIBUTION)) {
    const [technique, winner] = key.split("_");
    assert.ok(Object.hasOwn(TECHNIQUE_NAMES, technique));
    assert.ok(courses.includes(Number(winner)));
    assert.ok(Number.isInteger(entry.sampleSize) && entry.sampleSize > 0);
    placements(entry, Number(winner));
  }
});

test("30件以上は同じオブジェクトを返す（30件境界を含む）", () => {
  assert.equal(PLACEMENT_DISTRIBUTION.nuki_6.sampleSize, 30);
  for (const [key, entry] of Object.entries(PLACEMENT_DISTRIBUTION)) {
    if (entry.sampleSize < 30) continue;
    const [technique, winner] = key.split("_");
    assert.strictEqual(getPlacementBaseline(technique, Number(winner)), entry);
  }
});

test("29件と未登録の組は同じ決まり手の30件以上の加重平均", () => {
  const small = Object.entries(PLACEMENT_DISTRIBUTION)
    .filter(([, entry]) => entry.sampleSize < 30).map(([key]) => key);
  assert.deepEqual(small, ["sashi_6"]);
  assert.equal(PLACEMENT_DISTRIBUTION.sashi_6.sampleSize, 29);
  // 6は少数、1は未登録。全コースを照合し、除外コースの違いも検査する。
  for (const [technique, winner] of [["sashi", 6], ["sashi", 1], ["nige", 2]]) {
    const eligible = Object.entries(PLACEMENT_DISTRIBUTION)
      .filter(([key, entry]) => key.split("_")[0] === technique && entry.sampleSize >= 30)
      .map(([, entry]) => entry);
    const actual = getPlacementBaseline(technique, winner);
    assert.deepEqual(actual, weightedExpectation(eligible, winner));
    placements(actual, winner);
  }
});

test("nukiの未登録コース7の加重平均は30件の組を含む501件", () => {
  const entries = courses.map((course) => PLACEMENT_DISTRIBUTION[`nuki_${course}`]);
  const sampleSize = sum(entries.map((entry) => entry.sampleSize));
  const actual = getPlacementBaseline("nuki", 7);
  // 範囲外の勝者コースで追加されるキーの形は仕様未定。実行時の値だけ残す。
  KNOWN_GAPS.push({
    input: ["nuki", 7],
    specification: "未定（範囲外の勝者コース）",
    actual: { second: Object.keys(actual.second), third: Object.keys(actual.third) },
  });
  assert.equal(sampleSize, 501);
  assert.equal(actual.sampleSize, sampleSize);
  // weightedExpectationと同じ式。7は1〜6に無いので除外せず、配列外に書かない。
  for (const rank of ["second", "third"]) {
    const means = courses.map((course) => round3(sum(entries.map(
      (entry) => entry[rank][course] * entry.sampleSize,
    )) / sampleSize));
    const total = sum(means);
    const expected = means.map((mean) => round3(mean / total));
    assert.deepEqual(courses.map((course) => actual[rank][course]), expected);
  }
});

test("未知の決まり手は全体平均から勝者を除外して再正規化", () => {
  // グローバル平均のコメントに従う。未知キーでも sampleSize=7642 を返すのは
  // フォールバックの母数であり、未知の決まり手の実測件数ではない。
  const expected = {
    second: { 1: 0.216, 2: 0.327, 3: 0, 4: 0.201, 5: 0.157, 6: 0.099 },
    third: { 1: 0.109, 2: 0.235, 3: 0, 4: 0.245, 5: 0.215, 6: 0.195 },
    sampleSize: 7642,
  };
  const actual = getPlacementBaseline("zzz", 3);
  assert.deepEqual(actual, expected);
  placements(actual, 3);
});

test("変換・補完で元の表を変更しない", () => {
  assert.equal(JSON.stringify([
    TECHNIQUES, TECHNIQUE_NAMES, COURSE_DEFAULT_DISTRIBUTION,
    COURSE_DEFAULT_DEFENSE, PLACEMENT_DISTRIBUTION,
  ]), before);
});

console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`verify-technique-placement-tables: ${failed}件失敗`);
if (failed) process.exitCode = 1;
