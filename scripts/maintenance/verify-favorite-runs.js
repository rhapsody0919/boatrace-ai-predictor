#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildFavoriteRuns, statLineOf, buildFavoritesFallback, venuesFromPredictions } from "../../src/pure/favoriteRuns.js";

const entry = (racerId, number) => ({ racerId, number, name: `選手${racerId}`, grade: "A1" });
const race = (venueCode, raceNumber, startTime, entries = [], extra = {}) => ({
  raceId: `${venueCode}-${raceNumber}`, venueCode, raceNumber, startTime,
  raceGrade: "G2", cancellationStatus: null, seriesDay: 3, entries, ...extra,
});
const data = [
  { placeCd: 1, races: [race(1, 7, "17:46", [entry(4320, 3)]), race(1, 11, "19:42", [entry(4320, 6)])] },
  { placeCd: 12, races: [race(12, 8, "18:12", [entry(3941, 1)]), race(12, 12, "20:00")] },
  { placeCd: 22, races: [race(22, 9, "18:40", [entry(5000, 2)], { cancellationStatus: "中止" }), race(22, 12, "20:30")] },
];
const original = structuredClone(data);
const ids = [4320, 3941, 5000, 9999];
const result = buildFavoriteRuns(data, ids, "18:00");
assert.deepEqual(result, {
  past: [{ raceId: "1-7", venueCode: 1, raceNumber: 7, startTime: "17:46", raceGrade: "G2", boat: 3, racerId: 4320, name: "選手4320", grade: "A1" }],
  upcoming: [
    { raceId: "12-8", venueCode: 12, raceNumber: 8, startTime: "18:12", raceGrade: "G2", boat: 1, racerId: 3941, name: "選手3941", grade: "A1" },
    { raceId: "1-11", venueCode: 1, raceNumber: 11, startTime: "19:42", raceGrade: "G2", boat: 6, racerId: 4320, name: "選手4320", grade: "A1" },
  ], runningRacerCount: 2, raceCount: 3,
});
assert.equal(buildFavoriteRuns(data, ids, null).upcoming.length, 3);
assert.equal(buildFavoriteRuns(data, ids, null).past.length, 0);
assert.equal(buildFavoriteRuns(data, ids, "17:46").past.length, 1);
assert.equal(buildFavoriteRuns(data, ids, "23:59").past.length, 3);
assert.deepEqual(buildFavoriteRuns([], ids, null), { upcoming: [], past: [], runningRacerCount: 0, raceCount: 0 });
assert.equal(buildFavoriteRuns(data, [], null).raceCount, 0);
const ties = [{ placeCd: 12, races: [race(12, 8, "18:00", [entry(4320, 2), entry(3941, 3)])] },
  { placeCd: 1, races: [race(1, 11, "18:00", [entry(4320, 6)]), race(1, 7, "18:00", [entry(3941, 1)])] }];
const tied = buildFavoriteRuns(ties, [4320, 3941, 4320], null);
assert.deepEqual(tied.upcoming.map((r) => r.raceId), ["1-7", "1-11", "12-8", "12-8"]);
assert.equal(tied.raceCount, 3);
assert.equal(tied.runningRacerCount, 2);
for (const [input, expected] of [
  [{ key: 3, n: 55, top2Rate: 0.382 }, { kind: "rate", n: 55, ratePct: "38.2" }],
  [{ n: 29, top2Rate: 0.5 }, { kind: "count", n: 29 }],
  [{ n: 1, top2Rate: null }, { kind: "count", n: 1 }],
  [{ n: 30, top2Rate: 0.5 }, { kind: "rate", n: 30, ratePct: "50.0" }],
  [{ n: 30, top2Rate: 0 }, { kind: "rate", n: 30, ratePct: "0.0" }],
  [{ n: 30, top2Rate: 1 / 3 }, { kind: "rate", n: 30, ratePct: "33.3" }],
  [{ n: 0, top2Rate: 0 }, { kind: "none" }], [undefined, { kind: "none" }],
]) assert.deepEqual(statLineOf(input), expected);
assert.deepEqual(buildFavoritesFallback(data, [12, 3], "18:00"), {
  favVenues: [
    { venueCode: 12, state: "open", nextRaceNumber: 8, nextStartTime: "18:12" },
    { venueCode: 3, state: "closed", nextRaceNumber: null, nextStartTime: null },
  ], gradeVenues: [], openVenueCount: 3,
});
assert.equal(buildFavoritesFallback(data, [1], "19:42").favVenues[0].state, "finished");
assert.equal(buildFavoritesFallback(data, [1], null).favVenues[0].nextRaceNumber, 7);
assert.equal(buildFavoritesFallback(data, [22], "18:00").favVenues[0].nextRaceNumber, 12);
const grades = [
  { placeCd: 12, races: [race(12, 1, "10:00", [], { raceGrade: "G1" }), race(12, 12, "20:00"), race(12, 11, "19:00")] },
  { placeCd: 22, races: [race(22, 1, "11:00", [], { raceGrade: "SG" })] },
  { placeCd: 1, races: [race(1, 7, "12:00", [], { raceGrade: "SG" }), race(1, 11, "19:42")] },
  { placeCd: 3, races: [] },
  { placeCd: 4, races: [race(4, 1, "12:00"), race(4, 12, "20:00", [], { raceGrade: "SG" })] },
];
assert.deepEqual(buildFavoritesFallback(grades, [], null), {
  favVenues: [], openVenueCount: 4,
  gradeVenues: [
    { venueCode: 1, grade: "SG", seriesDay: 3, finalStartTime: "19:42" },
    { venueCode: 22, grade: "SG", seriesDay: 3, finalStartTime: "11:00" },
    { venueCode: 12, grade: "G1", seriesDay: 3, finalStartTime: "20:00" },
  ],
});
assert.deepEqual(buildFavoritesFallback([], [], null), { favVenues: [], gradeVenues: [], openVenueCount: 0 });
assert.deepEqual(buildFavoritesFallback(data, [12, 1], "23:59").favVenues, [
  { venueCode: 12, state: "finished", nextRaceNumber: null, nextStartTime: null },
  { venueCode: 1, state: "finished", nextRaceNumber: null, nextStartTime: null },
]);
assert.deepEqual(buildFavoritesFallback([{ placeCd: 3, races: [] }], [3], null).favVenues,
  [{ venueCode: 3, state: "closed", nextRaceNumber: null, nextStartTime: null }]);
const cancelled = [{ placeCd: 22, races: [race(22, 9, "18:40", [entry(5000, 2)], { cancellationStatus: true })] }];
assert.deepEqual(buildFavoritesFallback(cancelled, [22], "18:00"), {
  favVenues: [{ venueCode: 22, state: "finished", nextRaceNumber: null, nextStartTime: null }],
  gradeVenues: [], openVenueCount: 1,
});
// getPredictions の平らな races（選手は players）を会場別にまとめ、buildFavoriteRuns に通る形にする（BOA-1272）
const flat = [
  { raceId: "a", venueCode: 12, raceNumber: 8, startTime: "18:12", raceGrade: "G2", cancellationStatus: null,
    players: [{ number: 1, racerId: 4320, name: "峰", grade: "A1" }] },
  { raceId: "b", venueCode: 1, raceNumber: 7, startTime: "17:46", raceGrade: "SG", cancellationStatus: null },
  { raceId: "c", venueCode: 12, raceNumber: 9, startTime: "18:40", raceGrade: "G2", cancellationStatus: null,
    players: [{ number: 4, racerId: 4320, name: "峰", grade: "A1" }] },
];
const grouped = venuesFromPredictions(flat);
assert.deepEqual(grouped.map((v) => [v.placeCd, v.races.map((r) => r.raceId)]), [[12, ["a", "c"]], [1, ["b"]]]);
assert.deepEqual(grouped[1].races[0].entries, [], "players が無いレースは entries を空にする（落ちない）");
assert.deepEqual(buildFavoriteRuns(grouped, [4320], null).upcoming.map((r) => [r.raceId, r.boat]), [["a", 1], ["c", 4]]);
assert.deepEqual(venuesFromPredictions(undefined), []);
const gradesBefore = structuredClone(grades);
buildFavoritesFallback(grades, [12, 1], "11:00");
assert.deepEqual(grades, gradesBefore);
assert.deepEqual(data, original, "入力を変更しない");
console.log("OK: favorite runs・成績の境界・会場の代替表示");
