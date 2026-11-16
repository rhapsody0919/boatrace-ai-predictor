/**
 * venue の型 makeVenue（src/pure/venueModel.js）の振る舞いの試験。DB・ネットワーク・fs は使わない。
 */
import assert from "node:assert/strict";
import { makeVenue } from "../../src/pure/venueModel.js";

const venue = (extra = {}) => ({ code: 1, name: "桐生", water_type: "fresh", cluster: "balanced", avg_first_win_rate: 0.55, ...extra });

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
  const row = venue();
  const out = makeVenue(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("会場コードは1と24が通り、0・25・小数・文字列は RangeError（値を含む）", () => {
  assert.equal(makeVenue(venue({ code: 24 })).code, 24);
  throwsRange(() => makeVenue(venue({ code: 25 })), /会場コードが1〜24でない: 25（venue code=25）/);
  throwsRange(() => makeVenue(venue({ code: 0 })), /会場コードが1〜24でない: 0/);
  throwsRange(() => makeVenue(venue({ code: 1.5 })), /会場コード/);
  throwsRange(() => makeVenue(venue({ code: "1" })), /会場コード/);
});

test("name が文字列でない行は RangeError", () => {
  throwsRange(() => makeVenue(venue({ name: null })), /name が文字列でない: null/);
  throwsRange(() => makeVenue(venue({ name: 5 })), /name/);
});

test("cluster は3値か null（取得していない列も可）。知らない値は RangeError", () => {
  for (const c of ["in_strong", "out_strong", "balanced", null]) assert.equal(makeVenue(venue({ cluster: c })).cluster, c);
  assert.equal(makeVenue({ code: 2, name: "戸田" }).cluster, undefined);
  throwsRange(() => makeVenue(venue({ cluster: "strong" })), /cluster が不明な値: strong/);
});

test("avg_first_win_rate は0〜1か null。範囲外・文字列は RangeError", () => {
  for (const r of [0, 1, null]) assert.equal(makeVenue(venue({ avg_first_win_rate: r })).avg_first_win_rate, r);
  throwsRange(() => makeVenue(venue({ avg_first_win_rate: 1.2 })), /avg_first_win_rate が0〜1でない: 1.2/);
  throwsRange(() => makeVenue(venue({ avg_first_win_rate: -0.1 })), /avg_first_win_rate/);
  throwsRange(() => makeVenue(venue({ avg_first_win_rate: "0.5" })), /avg_first_win_rate/);
  throwsRange(() => makeVenue(venue({ avg_first_win_rate: Number.NaN })), /avg_first_win_rate/);
});

test("water_type は検査しない（初期データが公式と食い違うため、null も未知の値も通す）", () => {
  assert.equal(makeVenue(venue({ water_type: null })).water_type, null);
  assert.equal(makeVenue(venue({ water_type: "sea" })).water_type, "sea");
});

test("null・配列・非オブジェクトは TypeError", () => {
  assert.throws(() => makeVenue(null), TypeError);
  assert.throws(() => makeVenue([]), TypeError);
  assert.throws(() => makeVenue("x"), TypeError);
});

console.log(`verify-venue-model: ${count} 件 OK`);
