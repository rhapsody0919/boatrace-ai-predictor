/**
 * meet（節 = race_series の行）の型 makeMeet（src/pure/meetModel.js）の振る舞いの試験。
 * DB・ネットワーク・fs は使わない。既存の節の計算を meetModel から読めること（入口の集約）も見る。
 */
import assert from "node:assert/strict";
import { groupIntoCurrentMeet, groupIntoMeetBeforeRace, makeMeet, meetExclusionsOf } from "../../src/pure/meetModel.js";
import { groupIntoCurrentMeet as origGroup } from "../../src/pure/meetGrouping.js";
import { meetExclusionsOf as origExclusions } from "../../src/pure/meetExclusion.js";

const meet = (extra = {}) => ({
  venue_code: 1, start_date: "2026-11-10", end_date: "2026-11-15", total_days: 6,
  class_code: "G1", kind: "g1", grade: "G1", title: "テスト記念", ...extra,
});

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}
function throwsRange(fn, pattern) {
  assert.throws(fn, (e) => e instanceof RangeError && pattern.test(e.message));
}

test("正の例は凍結した写しで、引数を変えない", () => {
  const row = meet();
  const out = makeMeet(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("1日だけの節・月またぎ・閏日の日数が合えば通る", () => {
  assert.equal(makeMeet(meet({ start_date: "2026-11-10", end_date: "2026-11-10", total_days: 1 })).total_days, 1);
  assert.equal(makeMeet(meet({ start_date: "2026-10-30", end_date: "2026-11-03", total_days: 5 })).total_days, 5);
  assert.equal(makeMeet(meet({ start_date: "2028-02-28", end_date: "2028-03-01", total_days: 3 })).total_days, 3);
});

test("会場コード0・25・小数は RangeError（値と節の主キーを含む）", () => {
  throwsRange(() => makeMeet(meet({ venue_code: 25 })), /会場コードが1〜24でない: 25（meet venue_code=25 start_date=2026-11-10）/);
  throwsRange(() => makeMeet(meet({ venue_code: 0 })), /会場コード/);
  throwsRange(() => makeMeet(meet({ venue_code: 1.5 })), /会場コード/);
});

test("日付の形の誤り・実在しない日は RangeError", () => {
  throwsRange(() => makeMeet(meet({ start_date: "2026-11-1" })), /start_date が YYYY-MM-DD/);
  throwsRange(() => makeMeet(meet({ start_date: "2026-02-30", end_date: "2026-03-03", total_days: 2 })), /start_date/);
  throwsRange(() => makeMeet(meet({ end_date: null })), /end_date/);
  throwsRange(() => makeMeet(meet({ end_date: "2026-13-01" })), /end_date/);
});

test("end_date が start_date より前は RangeError", () => {
  throwsRange(() => makeMeet(meet({ end_date: "2026-11-09", total_days: 0 })), /end_date が start_date より前: 2026-11-09/);
});

test("total_days が日数と違う行は RangeError（期待値を含む）", () => {
  throwsRange(() => makeMeet(meet({ total_days: 5 })), /total_days が end_date - start_date \+ 1 と違う: 5（期待 6/);
  throwsRange(() => makeMeet(meet({ total_days: "6" })), /total_days/);
});

test("class_code は9値、Ippan は大文字始まり。知らない値は RangeError", () => {
  for (const c of ["SG", "G1", "G2", "G3", "Ippan", "Lady", "Venus", "Rookie", "Takumi"]) {
    assert.equal(makeMeet(meet({ class_code: c })).class_code, c);
  }
  throwsRange(() => makeMeet(meet({ class_code: "ippan" })), /class_code が不明な値: ippan/);
  throwsRange(() => makeMeet(meet({ class_code: null })), /class_code/);
});

test("kind は9値（小文字、masters を含む）。知らない値は RangeError", () => {
  for (const k of ["sg", "g1", "g2", "g3", "ippan", "lady", "venus", "rookie", "masters"]) {
    assert.equal(makeMeet(meet({ kind: k })).kind, k);
  }
  throwsRange(() => makeMeet(meet({ kind: "G1" })), /kind が不明な値: G1/);
  throwsRange(() => makeMeet(meet({ kind: undefined })), /kind/);
});

test("grade は null・未取得も通り、5値以外は RangeError（kind とは別の語彙）", () => {
  assert.equal(makeMeet(meet({ grade: null })).grade, null);
  const { grade, ...noGrade } = meet();
  assert.ok(grade);
  assert.equal(makeMeet(noGrade).grade, undefined);
  assert.equal(makeMeet(meet({ grade: "ippan" })).grade, "ippan");
  throwsRange(() => makeMeet(meet({ grade: "Ippan" })), /grade が不明な値: Ippan/);
  throwsRange(() => makeMeet(meet({ grade: "g1" })), /grade/);
});

test("title が null の行も通る", () => {
  assert.equal(makeMeet(meet({ title: null })).title, null);
});

test("null・配列・非オブジェクトは TypeError", () => {
  assert.throws(() => makeMeet(null), TypeError);
  assert.throws(() => makeMeet([]), TypeError);
  assert.throws(() => makeMeet("x"), TypeError);
});

test("既存の節の計算が meetModel から同じ関数で読める", () => {
  assert.equal(groupIntoCurrentMeet, origGroup);
  assert.equal(meetExclusionsOf, origExclusions);
  assert.equal(typeof groupIntoMeetBeforeRace, "function");
});

console.log(`verify-meet-model: ${count} 件 OK`);
