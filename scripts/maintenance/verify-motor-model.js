/**
 * motor の型 makeMotorStat・makeMotorPretest（src/pure/motorModel.js）の振る舞いの試験。DB・ネットワーク・fs は使わない。
 */
import assert from "node:assert/strict";
import { makeMotorPretest, makeMotorStat } from "../../src/pure/motorModel.js";

const stat = (extra = {}) => ({
  venue_code: 1,
  motor_number: 23,
  scraped_date: "2026-11-01",
  meet_count: 12,
  race_count: 80,
  final_count: 3,
  championship_count: 1,
  first_place_count: 20,
  second_place_count: 15,
  third_place_count: 10,
  win_rate: 6.12,
  top2_rate: 43.75,
  top3_rate: 56.25,
  accident_rate: 0,
  best_time: 1.45,
  avg_exhibition_time: 6.78,
  stats_period_start: "2026-05-01",
  stats_period_end: "2026-10-31",
  source_template: "kiryu",
  ...extra,
});
const pretest = (extra = {}) => ({
  race_date: "2026-11-01",
  venue_code: 2,
  racer_id: 4320,
  racer_class: "A1",
  motor_number: 41,
  motor_2rate: 38.5,
  boat_number: 12,
  boat_2rate: 30.1,
  pretest_time: 6.71,
  pretest_rank: 3,
  series_title: null,
  ...extra,
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

test("makeMotorStat: 正の例は凍結した写しで、引数を変えない", () => {
  const row = stat();
  const out = makeMotorStat(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("makeMotorStat: 会場コードは1と24が通り、0・25・小数・文字列は RangeError（主キーを含む）", () => {
  assert.equal(makeMotorStat(stat({ venue_code: 24 })).venue_code, 24);
  throwsRange(() => makeMotorStat(stat({ venue_code: 25 })), /会場コードが1〜24でない: 25（motor venue_code=25 motor_number=23 scraped_date=2026-11-01）/);
  throwsRange(() => makeMotorStat(stat({ venue_code: 0 })), /会場コードが1〜24でない: 0/);
  throwsRange(() => makeMotorStat(stat({ venue_code: 1.5 })), /会場コード/);
  throwsRange(() => makeMotorStat(stat({ venue_code: "1" })), /会場コード/);
});

test("makeMotorStat: motor_number は smallint の整数。null・小数・文字列・範囲外は RangeError", () => {
  for (const n of [-32768, 0, 32767]) assert.equal(makeMotorStat(stat({ motor_number: n })).motor_number, n);
  throwsRange(() => makeMotorStat(stat({ motor_number: null })), /motor_number が-32768〜32767でない: null/);
  throwsRange(() => makeMotorStat(stat({ motor_number: 32768 })), /motor_number/);
  throwsRange(() => makeMotorStat(stat({ motor_number: -32769 })), /motor_number/);
  throwsRange(() => makeMotorStat(stat({ motor_number: 2.5 })), /motor_number/);
  throwsRange(() => makeMotorStat(stat({ motor_number: "23" })), /motor_number/);
});

test("makeMotorStat: scraped_date は実在する日。欠け・2026-02-30・形違いは RangeError", () => {
  throwsRange(() => makeMotorStat(stat({ scraped_date: undefined })), /scraped_date が YYYY-MM-DD の実在する日でない: undefined/);
  throwsRange(() => makeMotorStat(stat({ scraped_date: "2026-02-30" })), /scraped_date/);
  throwsRange(() => makeMotorStat(stat({ scraped_date: "2026/11/01" })), /scraped_date/);
});

test("makeMotorStat: source_template は取ったときだけ文字列か見る（null は RangeError、取らない列は通す）", () => {
  const { source_template: _s, ...partial } = stat();
  assert.equal(makeMotorStat(partial).source_template, undefined);
  throwsRange(() => makeMotorStat(stat({ source_template: null })), /source_template が文字列でない: null/);
  throwsRange(() => makeMotorStat(stat({ source_template: 1 })), /source_template/);
});

test("makeMotorStat: 回数の7列は null か smallint の整数。小数・文字列は RangeError", () => {
  for (const key of ["meet_count", "race_count", "final_count", "championship_count", "first_place_count", "second_place_count", "third_place_count"]) {
    assert.equal(makeMotorStat(stat({ [key]: null }))[key], null);
    assert.equal(makeMotorStat(stat({ [key]: 0 }))[key], 0);
    assert.equal(makeMotorStat(stat({ [key]: -32768 }))[key], -32768);
    throwsRange(() => makeMotorStat(stat({ [key]: -32769 })), new RegExp(key));
    throwsRange(() => makeMotorStat(stat({ [key]: 1.5 })), new RegExp(`motor の ${key} が-32768〜32767でない: 1.5`));
    throwsRange(() => makeMotorStat(stat({ [key]: "3" })), new RegExp(key));
    throwsRange(() => makeMotorStat(stat({ [key]: 32768 })), new RegExp(key));
  }
});

test("makeMotorStat: 集計の期間は null か実在する日", () => {
  assert.equal(makeMotorStat(stat({ stats_period_start: null, stats_period_end: null })).stats_period_end, null);
  throwsRange(() => makeMotorStat(stat({ stats_period_start: "2026-13-01" })), /stats_period_start が YYYY-MM-DD/);
  throwsRange(() => makeMotorStat(stat({ stats_period_end: "2026-11-31" })), /stats_period_end が YYYY-MM-DD/);
});

test("makeMotorStat: 主キーだけの行（select で一部の列）も通す。率・時間の列は検査しない", () => {
  assert.equal(makeMotorStat({ venue_code: 3, motor_number: 7, scraped_date: "2026-01-31" }).motor_number, 7);
  assert.equal(makeMotorStat(stat({ win_rate: null, best_time: "1.45" })).best_time, "1.45");
});

test("makeMotorPretest: 正の例は凍結した写しで、引数を変えない", () => {
  const row = pretest();
  const out = makeMotorPretest(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("makeMotorPretest: race_date は実在する日、会場コードは1〜24（主キーを含む文）", () => {
  throwsRange(() => makeMotorPretest(pretest({ race_date: "2026-02-29" })), /pretest の race_date が YYYY-MM-DD の実在する日でない: 2026-02-29（pretest race_date=2026-02-29 venue_code=2 racer_id=4320）/);
  assert.equal(makeMotorPretest(pretest({ venue_code: 24 })).venue_code, 24);
  throwsRange(() => makeMotorPretest(pretest({ venue_code: 25 })), /pretest の会場コードが1〜24でない: 25/);
  throwsRange(() => makeMotorPretest(pretest({ venue_code: 0 })), /会場コード/);
});

test("makeMotorPretest: racer_id は integer の整数。null・小数・範囲外は RangeError", () => {
  for (const n of [-2147483648, 2147483647]) assert.equal(makeMotorPretest(pretest({ racer_id: n })).racer_id, n);
  throwsRange(() => makeMotorPretest(pretest({ racer_id: null })), /racer_id が-2147483648〜2147483647でない: null/);
  throwsRange(() => makeMotorPretest(pretest({ racer_id: 2147483648 })), /racer_id/);
  throwsRange(() => makeMotorPretest(pretest({ racer_id: -2147483649 })), /racer_id/);
  throwsRange(() => makeMotorPretest(pretest({ racer_id: 4320.5 })), /racer_id/);
});

test("makeMotorPretest: racer_class は4値。null・知らない値は RangeError、取らない列は通す", () => {
  for (const c of ["A1", "A2", "B1", "B2"]) assert.equal(makeMotorPretest(pretest({ racer_class: c })).racer_class, c);
  throwsRange(() => makeMotorPretest(pretest({ racer_class: "C1" })), /racer_class が不明な値: C1/);
  throwsRange(() => makeMotorPretest(pretest({ racer_class: null })), /racer_class/);
  assert.equal(makeMotorPretest({ race_date: "2026-11-01", venue_code: 2, racer_id: 1 }).racer_class, undefined);
});

test("makeMotorPretest: motor_number・boat_number は取ったときだけ smallint の整数", () => {
  throwsRange(() => makeMotorPretest(pretest({ motor_number: null })), /pretest の motor_number/);
  throwsRange(() => makeMotorPretest(pretest({ motor_number: 32768 })), /pretest の motor_number/);
  throwsRange(() => makeMotorPretest(pretest({ motor_number: -32769 })), /pretest の motor_number/);
  throwsRange(() => makeMotorPretest(pretest({ boat_number: 1.5 })), /pretest の boat_number/);
  throwsRange(() => makeMotorPretest(pretest({ boat_number: 32768 })), /pretest の boat_number/);
  throwsRange(() => makeMotorPretest(pretest({ boat_number: -32769 })), /pretest の boat_number/);
  assert.equal(makeMotorPretest(pretest({ motor_number: -32768, boat_number: 32767 })).boat_number, 32767);
});

test("makeMotorPretest: pretest_rank は null か1以上の整数", () => {
  assert.equal(makeMotorPretest(pretest({ pretest_rank: 1 })).pretest_rank, 1);
  assert.equal(makeMotorPretest(pretest({ pretest_rank: 32767 })).pretest_rank, 32767);
  throwsRange(() => makeMotorPretest(pretest({ pretest_rank: 0 })), /pretest_rank が1〜32767でない: 0/);
  throwsRange(() => makeMotorPretest(pretest({ pretest_rank: 32768 })), /pretest_rank/);
  throwsRange(() => makeMotorPretest(pretest({ pretest_rank: 2.5 })), /pretest_rank/);
});

test("makeMotorPretest: pretest_time と pretest_rank は両方 null か両方あり（片方だけ取った行は見ない）", () => {
  assert.equal(makeMotorPretest(pretest({ pretest_time: null, pretest_rank: null })).pretest_rank, null);
  throwsRange(() => makeMotorPretest(pretest({ pretest_time: null })), /pretest_time と pretest_rank の片方だけが null: null・3（pretest race_date=2026-11-01/);
  throwsRange(() => makeMotorPretest(pretest({ pretest_rank: null })), /片方だけが null: 6.71・null/);
  const { pretest_rank: _r, ...noRank } = pretest({ pretest_time: null });
  assert.equal(makeMotorPretest(noRank).pretest_time, null);
  const { pretest_time: _t, ...noTime } = pretest({ pretest_rank: null });
  assert.equal(makeMotorPretest(noTime).pretest_rank, null);
});

test("null・配列・非オブジェクトは TypeError（関数名を含む）", () => {
  for (const [fn, name] of [[makeMotorStat, "makeMotorStat"], [makeMotorPretest, "makeMotorPretest"]]) {
    assert.throws(() => fn(null), (e) => e instanceof TypeError && e.message.includes(name));
    assert.throws(() => fn([]), TypeError);
    assert.throws(() => fn("x"), TypeError);
  }
});

console.log(`verify-motor-model: ${count} 件 OK`);
