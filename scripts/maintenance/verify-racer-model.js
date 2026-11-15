/**
 * racer の型 makeRacer・makeRacerSeriesPoint（src/pure/racerModel.js）の振る舞いの試験。
 * DB・ネットワーク・fs は使わない。既存の選手の集計を racerModel から読めること（入口の集約）も見る。
 */
import assert from "node:assert/strict";
import { careerWinRate, isCareerFinalStage, makeRacer, makeRacerSeriesPoint } from "../../src/pure/racerModel.js";
import { careerWinRate as origRate } from "../../src/pure/racerCareerStats.js";

const racer = (extra = {}) => ({ racer_id: 4561, name: "選手", birth_date: "1990-04-05", sex: 1, branch: null, grade_at_scrape: "A1", ...extra });
const point = (extra = {}) => ({ venue_code: 1, meet_start_date: "2026-11-10", racer_id: 4561, rank: 3, score_rate: 7.5, remarks: null, next_race_1: 5, next_race_2: 12, next_series_day: 4, ...extra });

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}
function throwsRange(fn, pattern) {
  assert.throws(fn, (e) => e instanceof RangeError && pattern.test(e.message));
}

// --- makeRacer ---
test("racer: 正の例は凍結した写しで、引数を変えない", () => {
  const row = racer();
  const out = makeRacer(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("racer: sex・grade_at_scrape・身長などの null や未取得でも投げない", () => {
  const out = makeRacer({ racer_id: 3000, name: "選手", birth_date: "1980-01-01", sex: null, height_cm: null, grade_at_scrape: null });
  assert.equal(out.sex, null);
  assert.equal(makeRacer({ racer_id: 3000, name: "選手", birth_date: "1980-01-01" }).sex, undefined);
});

test("racer: racer_id が0・負・小数・文字列・null は RangeError（値を含む）", () => {
  throwsRange(() => makeRacer(racer({ racer_id: 0 })), /racer_id が1〜\d+でない: 0（racer_id=0）/);
  throwsRange(() => makeRacer(racer({ racer_id: -5 })), /racer_id/);
  throwsRange(() => makeRacer(racer({ racer_id: 4561.5 })), /racer_id/);
  throwsRange(() => makeRacer(racer({ racer_id: "4561" })), /racer_id/);
  throwsRange(() => makeRacer(racer({ racer_id: null })), /racer_id/);
});

test("racer: name が文字列でない行は RangeError", () => {
  throwsRange(() => makeRacer(racer({ name: null })), /name が文字列でない: null（racer_id=4561）/);
  throwsRange(() => makeRacer(racer({ name: undefined })), /name/);
});

test("racer: birth_date の形の誤り・実在しない日・null は RangeError", () => {
  throwsRange(() => makeRacer(racer({ birth_date: "1990/04/05" })), /birth_date が YYYY-MM-DD/);
  throwsRange(() => makeRacer(racer({ birth_date: "1990-02-30" })), /birth_date/);
  throwsRange(() => makeRacer(racer({ birth_date: null })), /birth_date/);
});

test("racer: sex が整数でない値は RangeError", () => {
  throwsRange(() => makeRacer(racer({ sex: "1" })), /sex/);
  throwsRange(() => makeRacer(racer({ sex: 1.5 })), /sex/);
});

test("racer: null・配列・非オブジェクトは TypeError", () => {
  assert.throws(() => makeRacer(null), TypeError);
  assert.throws(() => makeRacer([]), TypeError);
  assert.throws(() => makeRacer("x"), TypeError);
});

// --- makeRacerSeriesPoint ---
test("series_point: 正の例は凍結した写しで、引数を変えない", () => {
  const row = point();
  const out = makeRacerSeriesPoint(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("series_point: 賞典除外・途中帰郷（rank・score_rate・next_* が null）でも投げない", () => {
  const out = makeRacerSeriesPoint(point({ rank: null, score_rate: null, remarks: "途中帰郷", next_race_1: null, next_race_2: null, next_series_day: null }));
  assert.equal(out.rank, null);
  assert.equal(out.next_race_1, null);
  assert.equal(makeRacerSeriesPoint({ venue_code: 1, meet_start_date: "2026-11-10", racer_id: 4561 }).next_series_day, undefined);
});

test("series_point: next_race_1・2 は1〜12、next_series_day は1〜9（DB の CHECK と同じ）", () => {
  assert.equal(makeRacerSeriesPoint(point({ next_race_1: 1, next_race_2: 12, next_series_day: 9 })).next_series_day, 9);
  throwsRange(() => makeRacerSeriesPoint(point({ next_race_1: 0 })), /next_race_1 が1〜12でない: 0/);
  throwsRange(() => makeRacerSeriesPoint(point({ next_race_2: 13 })), /next_race_2 が1〜12でない: 13/);
  throwsRange(() => makeRacerSeriesPoint(point({ next_series_day: 10 })), /next_series_day が1〜9でない: 10/);
  throwsRange(() => makeRacerSeriesPoint(point({ next_series_day: 0 })), /next_series_day/);
});

test("series_point: 会場コード・日付・racer_id の誤りは RangeError", () => {
  throwsRange(() => makeRacerSeriesPoint(point({ venue_code: 25 })), /会場コードが1〜24でない: 25/);
  throwsRange(() => makeRacerSeriesPoint(point({ meet_start_date: "2026-11-31" })), /meet_start_date/);
  throwsRange(() => makeRacerSeriesPoint(point({ racer_id: 0 })), /racer_id/);
});

test("series_point: null・非オブジェクトは TypeError", () => {
  assert.throws(() => makeRacerSeriesPoint(null), TypeError);
  assert.throws(() => makeRacerSeriesPoint([]), TypeError);
});

test("既存の選手の集計が racerModel から同じ関数で読める", () => {
  assert.equal(careerWinRate, origRate);
  assert.equal(isCareerFinalStage("優勝戦"), true);
});

console.log(`verify-racer-model: ${count} 件 OK`);
