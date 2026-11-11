/**
 * race の型 makeRace・makeRaceEntry（src/pure/raceModel.js）の振る舞いの試験。
 * DB・ネットワーク・fs は使わない。
 */
import assert from "node:assert/strict";
import { makeRace, makeRaceEntry } from "../../src/pure/raceModel.js";

const RACE_ID = "2026-11-10-01-01";

const entry = (boat, extra = {}) => ({ race_id: RACE_ID, boat_number: boat, racer_id: 4000 + boat, player_name: `選手${boat}`, ...extra });
const entries = (boats) => boats.map((b) => entry(b));
const race = (extra = {}) => ({ race_id: RACE_ID, venue_code: 1, race_number: 1, race_date: "2026-11-10", ...extra });
const SIX = [1, 2, 3, 4, 5, 6];

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}

function throwsRange(fn, pattern) {
  assert.throws(fn, (e) => e instanceof RangeError && pattern.test(e.message));
}

// --- makeRaceEntry ---
test("entry: 正の例は凍結した写しで、引数を変えない", () => {
  const row = entry(3);
  const out = makeRaceEntry(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("entry: racer_id・player_name・率が null でも投げない", () => {
  const out = makeRaceEntry(entry(2, { racer_id: null, player_name: null, win_rate: null }));
  assert.equal(out.racer_id, null);
  assert.equal(out.player_name, null);
});

test("entry: 艇番7・0・小数・文字列は RangeError（値と race_id を含む）", () => {
  throwsRange(() => makeRaceEntry(entry(7)), /艇番が1〜6でない: 7（race_id=2026-11-10-01-01）/);
  throwsRange(() => makeRaceEntry(entry(0)), /艇番が1〜6でない: 0/);
  throwsRange(() => makeRaceEntry(entry(1.5)), /艇番/);
  throwsRange(() => makeRaceEntry(entry("1")), /艇番/);
});

test("entry: race_id の形の誤りは RangeError", () => {
  throwsRange(() => makeRaceEntry(entry(1, { race_id: "2026-11-10-1-1" })), /race_id/);
  throwsRange(() => makeRaceEntry(entry(1, { race_id: null })), /race_id/);
  throwsRange(() => makeRaceEntry(entry(1, { race_id: "2026-11-10-25-01" })), /race_id/);
});

test("entry: null・非オブジェクトは TypeError", () => {
  assert.throws(() => makeRaceEntry(null), TypeError);
  assert.throws(() => makeRaceEntry("x"), TypeError);
  assert.throws(() => makeRaceEntry([]), TypeError);
});

// --- makeRace ---
test("race: 6艇の正の例は凍結し、引数を変えない", () => {
  const row = race({ race_entries: entries(SIX) });
  const out = makeRace(row);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.race_entries));
  assert.ok(out.race_entries.every((e) => Object.isFrozen(e)));
  assert.equal(out.race_entries.length, 6);
  assert.ok(!Object.isFrozen(row));
  assert.ok(!Object.isFrozen(row.race_entries));
  assert.ok(!Object.isFrozen(row.race_entries[0]));
});

test("race: race_entries が無い・race_date が無い行も通る", () => {
  const out = makeRace({ race_id: RACE_ID, venue_code: 1, race_number: 1 });
  assert.ok(Object.isFrozen(out));
  assert.equal(out.race_entries, undefined);
});

test("race: 中止 confirmed の0艇・tentative の3艇・空配列", () => {
  assert.equal(makeRace(race({ cancellation_status: "confirmed", race_entries: [] })).race_entries.length, 0);
  assert.equal(makeRace(race({ cancellation_status: "tentative", race_entries: entries([1, 2, 3]) })).race_entries.length, 3);
  assert.equal(makeRace(race({ race_entries: [] })).race_entries.length, 0);
  assert.equal(makeRace(race({ cancellation_status: null, race_entries: entries(SIX) })).race_entries.length, 6);
});

test("race: racer_id null の艇を含む6艇", () => {
  const list = entries(SIX);
  list[2] = entry(3, { racer_id: null, player_name: null });
  assert.equal(makeRace(race({ race_entries: list })).race_entries[2].racer_id, null);
});

test("race: 艇番の重複は中止でも投げる", () => {
  throwsRange(() => makeRace(race({ race_entries: entries([1, 2, 3, 4, 5, 5]) })), /艇番が重複: 5（race_id=2026-11-10-01-01）/);
  throwsRange(() => makeRace(race({ cancellation_status: "confirmed", race_entries: entries([2, 2]) })), /重複/);
});

test("race: 艇番7・艇番0の艇は投げる", () => {
  throwsRange(() => makeRace(race({ race_entries: entries([1, 2, 3, 4, 5, 7]) })), /艇番が1〜6でない: 7/);
  throwsRange(() => makeRace(race({ race_entries: entries([0, 1, 2, 3, 4, 5]) })), /艇番が1〜6でない: 0/);
});

test("race: 中止でない5艇・7艇は投げる", () => {
  throwsRange(() => makeRace(race({ race_entries: entries([1, 2, 3, 4, 5]) })), /艇数が6艇でない: 5/);
  throwsRange(() => makeRace(race({ race_entries: entries([1, 2, 3, 4, 5, 6, 6]) })), /重複/);
  const seven = [...entries(SIX), entry(7)];
  throwsRange(() => makeRace(race({ race_entries: seven })), /艇番が1〜6でない: 7/);
  throwsRange(() => makeRace(race({ cancellation_status: "confirmed", race_entries: seven })), /艇番が1〜6でない: 7/);
});

test("race: 会場25・0、レース番号13・0は投げる", () => {
  throwsRange(() => makeRace(race({ venue_code: 25 })), /会場コードが1〜24でない: 25/);
  throwsRange(() => makeRace(race({ venue_code: 0 })), /会場コード/);
  throwsRange(() => makeRace(race({ race_number: 13 })), /レース番号が1〜12でない: 13/);
  throwsRange(() => makeRace(race({ race_number: 0 })), /レース番号/);
  throwsRange(() => makeRace(race({ venue_code: "1" })), /会場コード/);
});

test("race: race_id の形の誤りは投げる", () => {
  throwsRange(() => makeRace(race({ race_id: "2026-11-10-1-1" })), /race_id/);
  throwsRange(() => makeRace(race({ race_id: undefined })), /race_id/);
  throwsRange(() => makeRace(race({ race_id: "2026-11-10-01-13" })), /race_id/);
});

test("race: race_id と venue_code・race_number・race_date の食い違いは投げる", () => {
  throwsRange(() => makeRace(race({ venue_code: 2 })), /会場コードが食い違う: 2/);
  throwsRange(() => makeRace(race({ race_number: 2 })), /レース番号が食い違う: 2/);
  throwsRange(() => makeRace(race({ race_date: "2026-11-11" })), /race_date/);
});

test("race: cancellation_status の未知の値は投げる", () => {
  throwsRange(() => makeRace(race({ cancellation_status: "cancelled" })), /cancellation_status が不明な値: cancelled/);
  throwsRange(() => makeRace(race({ cancellation_status: "" })), /cancellation_status/);
});

test("race: null・非オブジェクトは TypeError", () => {
  assert.throws(() => makeRace(null), TypeError);
  assert.throws(() => makeRace(undefined), TypeError);
  assert.throws(() => makeRace(5), TypeError);
});

console.log(`verify-race-model: ${count} 件 OK`);
