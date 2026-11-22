// 実行: node --test scripts/tests/upcomingDeadlineRaces.test.js（BOA-1690）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  moreButtonVenues,
  selectUpcomingDeadlineRaces,
} from "../../src/pure/upcomingDeadlineRaces.js";
import { pickUpcomingDeadlineRaces } from "../../src/utils/raceListDisplay.js";

const DATE = "2026-11-22";
const racers = (name, rank = "A1") => [
  { waku: 1, name, rank },
  { waku: 2, name: "二号　艇", rank: "B1" },
];
const race = (placeCd, raceNo, startTime, extra = {}) => ({
  raceNo,
  startTime,
  date: DATE,
  placeCd,
  raceGrade: null,
  raceStage: null,
  cancellationStatus: null,
  result: null,
  inCaution: null,
  racers: racers("井上　　晴"),
  ...extra,
});
const venue = (placeCd, races) => ({ placeCd, placeName: "", races });

test("締切予定が今より後の行だけを近い順に最大6行。同じ時刻は会場コード → レース番号の順", () => {
  const data = [
    venue(18, [race(18, 4, "11:59"), race(18, 5, "12:00"), race(18, 6, "12:30")]),
    venue(2, [race(2, 4, "12:08"), race(2, 5, "12:30"), race(2, 6, "13:00")]),
    venue(15, [race(15, 4, "12:19"), race(15, 5, "12:45"), race(15, 6, "13:10")]),
  ];
  const rows = pickUpcomingDeadlineRaces(data, "12:00");
  assert.deepEqual(
    rows.map((r) => `${r.venueCode}-${r.raceNo}-${r.startTime}`),
    ["2-4-12:08", "15-4-12:19", "2-5-12:30", "18-6-12:30", "15-5-12:45", "2-6-13:00"],
  );
  assert.equal(rows[0].raceId, "2026-11-22-02-04");
});

test("中止・startTime の欠けた行・形の違う時刻は入れない。全レース終了なら空", () => {
  const data = [
    venue(1, [
      race(1, 1, "13:00", { cancellationStatus: "confirmed" }),
      race(1, 2, null),
      race(1, 3, ""),
      race(1, 4, "13:30"),
    ]),
  ];
  assert.deepEqual(
    pickUpcomingDeadlineRaces(data, "12:00").map((r) => r.raceNo),
    [4],
  );
  assert.deepEqual(pickUpcomingDeadlineRaces(data, "22:00"), []);
  assert.deepEqual(pickUpcomingDeadlineRaces(data, null), []);
  assert.deepEqual(pickUpcomingDeadlineRaces([], "12:00"), []);
});

test("1号艇の名前と級。1号艇が欠場（行が無い・名前が無い）なら選手名を出さない", () => {
  const data = [
    venue(3, [
      race(3, 1, "13:00"),
      race(3, 2, "13:10", { racers: [{ waku: 2, name: "二号", rank: "B1" }] }),
      race(3, 3, "13:20", { racers: [{ waku: 1, name: null, rank: "A1" }] }),
    ]),
  ];
  const rows = pickUpcomingDeadlineRaces(data, "12:00");
  assert.deepEqual(rows[0].boat1, { name: "井上 晴", rank: "A1" });
  assert.equal(rows[1].boat1, null);
  assert.equal(rows[2].boat1, null);
});

test("グレード・優勝戦・注意度は「高」の段だけ", () => {
  const data = [
    venue(18, [
      race(18, 12, "15:30", { raceGrade: "G1", raceStage: "優勝戦", inCaution: { pct: 60, level: "high" } }),
      race(18, 11, "15:00", { raceStage: "準優勝戦", inCaution: { pct: 30, level: "mid" } }),
    ]),
  ];
  const [r11, r12] = pickUpcomingDeadlineRaces(data, "12:00");
  assert.equal(r12.gradeLabel, "G1");
  assert.equal(r12.isFinal, true);
  assert.equal(r12.cautionHigh, true);
  assert.equal(r11.gradeLabel, null);
  assert.equal(r11.isFinal, false);
  assert.equal(r11.cautionHigh, false);
});

test("隠れる行（4行目以降）と「もっと見る」に出す会場（重ねずに先頭から2会場、残りがあれば hasOthers）", () => {
  const rows = [
    { venueCode: 2, isFinal: false },
    { venueCode: 15, isFinal: false },
    { venueCode: 4, isFinal: false },
    { venueCode: 18, isFinal: true },
    { venueCode: 18, isFinal: false },
    { venueCode: 1, isFinal: false },
  ];
  const more = moreButtonVenues(rows);
  assert.equal(more.hidden.length, 3);
  assert.deepEqual(more.venues, [
    { venueCode: 18, isFinal: true },
    { venueCode: 1, isFinal: false },
  ]);
  assert.equal(more.hasOthers, false);
  const withOthers = moreButtonVenues([...rows.slice(0, 4), { venueCode: 1 }, { venueCode: 7 }]);
  assert.equal(withOthers.hasOthers, true);
  const none = moreButtonVenues(rows.slice(0, 3));
  assert.deepEqual(none.hidden, []);
  assert.deepEqual(none.venues, []);
});

test("src/pure の選び方は部品（中止・グレード・選手名）が欠けたら例外（黙って既定の判定にしない）", () => {
  assert.throws(() => selectUpcomingDeadlineRaces([], "12:00", {}), /部品 isRaceCancelled が無い/);
});
