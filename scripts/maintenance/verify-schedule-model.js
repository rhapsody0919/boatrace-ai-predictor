/**
 * schedule の型 makeDigestDay・makeDigestRow（src/pure/scheduleModel.js）の振る舞いの試験。DB・ネットワーク・fs は使わない。
 */
import assert from "node:assert/strict";
import { makeDigestDay, makeDigestRow } from "../../src/pure/scheduleModel.js";

const METRIC_KEYS = ["metric_value", "metric_expected", "metric_skill_delta", "metric_venue_baseline", "metric_predicted", "sample_size", "course"];

const day = (extra = {}) => ({
  digest_date: "2026-11-01",
  generated_at: "2026-11-01T00:10:00+00:00",
  venue_count: 12,
  race_count: 144,
  window_start: "2026-08-03",
  window_end: "2026-10-31",
  window_days: 90,
  flying_data_complete: true,
  suppressed_venues: [3, 17],
  notes: null,
  ...extra,
});
const row = (extra = {}) => ({
  digest_date: "2026-11-01",
  section: "nige",
  rank: 1,
  race_id: "2026-11-01-02-12",
  venue_code: 2,
  race_number: 12,
  start_time: "20:40:00",
  racer_id: 4320,
  racer_name: "選手",
  grade: "A1",
  boat_number: 1,
  course: 1,
  metric_value: 62.5,
  metric_expected: 55,
  metric_skill_delta: 7.5,
  metric_venue_baseline: 50,
  metric_predicted: 60,
  sample_size: 40,
  is_small_sample: false,
  detail: null,
  ...extra,
});
const returnedRow = (extra = {}) => row({ section: "returned", race_id: null, race_number: null, boat_number: null, course: null, metric_value: null, sample_size: null, ...extra });

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}
function throwsRange(fn, pattern) {
  assert.throws(fn, (e) => e instanceof RangeError && pattern.test(e.message));
}

test("makeDigestDay: 正の例は凍結した写しで、引数を変えない", () => {
  const r = day();
  const out = makeDigestDay(r);
  assert.deepEqual(out, r);
  assert.notEqual(out, r);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(r));
});

test("makeDigestDay: digest_date は実在する日（主キーを含む文）", () => {
  throwsRange(() => makeDigestDay(day({ digest_date: "2026-02-30" })), /digest_day の digest_date が YYYY-MM-DD の実在する日でない: 2026-02-30（digest_day digest_date=2026-02-30）/);
  throwsRange(() => makeDigestDay(day({ digest_date: undefined })), /digest_date/);
});

test("makeDigestDay: venue_count・race_count は0以上の整数（mdd_counts_nonneg）", () => {
  for (const key of ["venue_count", "race_count"]) {
    assert.equal(makeDigestDay(day({ [key]: 0 }))[key], 0);
    assert.equal(makeDigestDay(day({ [key]: 32767 }))[key], 32767);
    throwsRange(() => makeDigestDay(day({ [key]: -1 })), new RegExp(`${key} が0〜32767でない: -1`));
    throwsRange(() => makeDigestDay(day({ [key]: 32768 })), new RegExp(key));
    throwsRange(() => makeDigestDay(day({ [key]: null })), new RegExp(key));
    throwsRange(() => makeDigestDay(day({ [key]: 1.5 })), new RegExp(key));
  }
});

test("makeDigestDay: window_end は window_start 以後（mdd_window_order）、どちらも実在する日", () => {
  assert.equal(makeDigestDay(day({ window_start: "2026-10-31" })).window_start, "2026-10-31");
  throwsRange(() => makeDigestDay(day({ window_start: "2026-11-01" })), /window_end が window_start より前: 2026-10-31/);
  throwsRange(() => makeDigestDay(day({ window_start: null })), /window_start が YYYY-MM-DD/);
  throwsRange(() => makeDigestDay(day({ window_end: "2026-11-31" })), /window_end が YYYY-MM-DD/);
  const { window_start: _s, ...noStart } = day({ window_end: "2000-01-01" });
  assert.equal(makeDigestDay(noStart).window_end, "2000-01-01");
  const { window_start: _s2, ...noStartOld } = day({ window_end: "1969-12-31" });
  assert.equal(makeDigestDay(noStartOld).window_end, "1969-12-31");
  const { window_end: _e, ...noEnd } = day({ window_start: "2099-01-01" });
  assert.equal(makeDigestDay(noEnd).window_start, "2099-01-01");
});

test("makeDigestDay: window_days は smallint の整数、flying_data_complete は真偽", () => {
  for (const n of [-32768, 32767]) assert.equal(makeDigestDay(day({ window_days: n })).window_days, n);
  throwsRange(() => makeDigestDay(day({ window_days: null })), /window_days が-32768〜32767でない: null/);
  throwsRange(() => makeDigestDay(day({ window_days: 32768 })), /window_days/);
  throwsRange(() => makeDigestDay(day({ window_days: -32769 })), /window_days/);
  assert.equal(makeDigestDay(day({ flying_data_complete: false })).flying_data_complete, false);
  throwsRange(() => makeDigestDay(day({ flying_data_complete: null })), /flying_data_complete が真偽でない: null/);
  throwsRange(() => makeDigestDay(day({ flying_data_complete: "true" })), /flying_data_complete/);
});

test("makeDigestDay: suppressed_venues は整数か null の配列（空も可）", () => {
  assert.deepEqual(makeDigestDay(day({ suppressed_venues: [] })).suppressed_venues, []);
  throwsRange(() => makeDigestDay(day({ suppressed_venues: null })), /suppressed_venues が配列でない: null/);
  throwsRange(() => makeDigestDay(day({ suppressed_venues: "3" })), /suppressed_venues が配列でない/);
  assert.deepEqual(makeDigestDay(day({ suppressed_venues: [3, null] })).suppressed_venues, [3, null]);
  throwsRange(() => makeDigestDay(day({ suppressed_venues: [3, 1.5] })), /suppressed_venues の要素が-32768〜32767でない: 1.5/);
  throwsRange(() => makeDigestDay(day({ suppressed_venues: [32768] })), /suppressed_venues の要素/);
  throwsRange(() => makeDigestDay(day({ suppressed_venues: [-32769] })), /suppressed_venues の要素/);
  assert.deepEqual(makeDigestDay(day({ suppressed_venues: [-32768, 32767] })).suppressed_venues, [-32768, 32767]);
});

test("makeDigestDay: 主キーだけの行も通す（generated_at・notes は検査しない）", () => {
  assert.equal(makeDigestDay({ digest_date: "2026-11-02" }).digest_date, "2026-11-02");
  assert.equal(makeDigestDay(day({ generated_at: null, notes: 1 })).generated_at, null);
});

test("makeDigestRow: 正の例（nige・flying・returned）は凍結した写しで、引数を変えない", () => {
  for (const r of [row(), row({ section: "flying", metric_value: null, course: null, sample_size: null }), returnedRow()]) {
    const out = makeDigestRow(r);
    assert.deepEqual(out, r);
    assert.notEqual(out, r);
    assert.ok(Object.isFrozen(out));
    assert.ok(!Object.isFrozen(r));
  }
});

test("makeDigestRow: 主キー（digest_date・section 6値・rank 1以上）", () => {
  throwsRange(() => makeDigestRow(row({ digest_date: "2026-13-01" })), /digest_row の digest_date が YYYY-MM-DD の実在する日でない: 2026-13-01（digest_row digest_date=2026-13-01 section=nige rank=1）/);
  for (const s of ["featured", "nige", "makuri", "nigashi"]) assert.equal(makeDigestRow(row({ section: s })).section, s);
  throwsRange(() => makeDigestRow(row({ section: "sashi" })), /section が不明な値: sashi/);
  assert.equal(makeDigestRow(row({ rank: 32767 })).rank, 32767);
  throwsRange(() => makeDigestRow(row({ rank: 0 })), /rank が1〜32767でない: 0/);
  throwsRange(() => makeDigestRow(row({ rank: 32768 })), /rank/);
  throwsRange(() => makeDigestRow(row({ rank: null })), /rank/);
});

test("makeDigestRow: 会場1〜24・racer_id 整数・racer_name 文字列・is_small_sample 真偽（取ったときだけ）", () => {
  assert.equal(makeDigestRow(row({ venue_code: 24 })).venue_code, 24);
  throwsRange(() => makeDigestRow(row({ venue_code: 25 })), /会場コードが1〜24でない: 25/);
  throwsRange(() => makeDigestRow(row({ venue_code: 0 })), /会場コード/);
  throwsRange(() => makeDigestRow(row({ venue_code: null })), /会場コード/);
  for (const n of [-2147483648, 2147483647]) assert.equal(makeDigestRow(row({ racer_id: n })).racer_id, n);
  throwsRange(() => makeDigestRow(row({ racer_id: null })), /racer_id が-2147483648〜2147483647でない: null/);
  throwsRange(() => makeDigestRow(row({ racer_id: 2147483648 })), /racer_id/);
  throwsRange(() => makeDigestRow(row({ racer_id: -2147483649 })), /racer_id/);
  throwsRange(() => makeDigestRow(row({ racer_name: null })), /racer_name が文字列でない: null/);
  throwsRange(() => makeDigestRow(row({ is_small_sample: null })), /is_small_sample が真偽でない: null/);
  assert.equal(makeDigestRow({ digest_date: "2026-11-01", section: "flying", rank: 2 }).rank, 2);
});

test("makeDigestRow: boat_number・course は null か1〜6、race_number は null か整数", () => {
  for (const key of ["boat_number", "course"]) {
    assert.equal(makeDigestRow(row({ [key]: 6 }))[key], 6);
    throwsRange(() => makeDigestRow(row({ [key]: 7 })), new RegExp(`${key} が1〜6でない: 7`));
    throwsRange(() => makeDigestRow(row({ [key]: 0 })), new RegExp(key));
  }
  for (const n of [-32768, 32767]) assert.equal(makeDigestRow(row({ race_number: n })).race_number, n);
  throwsRange(() => makeDigestRow(row({ race_number: 1.5 })), /race_number が-32768〜32767でない: 1.5/);
  throwsRange(() => makeDigestRow(row({ race_number: 32768 })), /race_number/);
  throwsRange(() => makeDigestRow(row({ race_number: -32769 })), /race_number/);
});

test("makeDigestRow: レースの3列は returned だけ null（mdr_race_fields_by_section）", () => {
  for (const key of ["race_id", "race_number", "boat_number"]) {
    throwsRange(() => makeDigestRow(row({ [key]: null })), new RegExp(`${key} が節の決まり（returned だけ null）に合わない: null`));
    throwsRange(() => makeDigestRow(row({ section: "flying", [key]: null })), new RegExp(key));
    throwsRange(() => makeDigestRow(returnedRow({ [key]: key === "race_id" ? "2026-11-01-02-12" : 1 })), new RegExp(`${key} が節の決まり`));
    const { [key]: _k, ...partial } = row({ [key]: null });
    assert.equal(makeDigestRow(partial)[key], undefined);
  }
});

test("makeDigestRow: 数値の7列は flying・returned 以外で null を許さない（mdr_metric_fields_by_section）", () => {
  for (const key of METRIC_KEYS) {
    throwsRange(() => makeDigestRow(row({ [key]: null })), new RegExp(`${key} が null（flying・returned 以外は必ずある`));
    throwsRange(() => makeDigestRow(row({ section: "featured", [key]: null })), new RegExp(key));
    assert.equal(makeDigestRow(row({ section: "flying", [key]: null }))[key], null);
    assert.equal(makeDigestRow(returnedRow({ [key]: null }))[key], null);
    const { [key]: _k, ...partial } = row();
    assert.equal(makeDigestRow(partial)[key], undefined);
  }
});

test("null・配列・非オブジェクトは TypeError（関数名を含む）", () => {
  for (const [fn, name] of [[makeDigestDay, "makeDigestDay"], [makeDigestRow, "makeDigestRow"]]) {
    assert.throws(() => fn(null), (e) => e instanceof TypeError && e.message.includes(name));
    assert.throws(() => fn([]), TypeError);
    assert.throws(() => fn("x"), TypeError);
  }
});

console.log(`verify-schedule-model: ${count} 件 OK`);
