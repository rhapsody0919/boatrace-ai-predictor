/**
 * 直前情報タブ「今節の足の推移と着順」（BOA-885）の表示用モデル
 * src/components/race/meetFormTrend.js を確かめる。
 *
 * - 走の集合は今節展示情報（getRacerMeetExhibitionTrendBefore）の走だけ。着順・進入・オリジナル展示は
 *   race_id で突き合わせる（艇ごとに走ったレースが違っても、他の艇の値が混ざらない）
 * - 着順の F・欠・転 はそのまま残す。進入が無い走は null
 * - 値が1つも無い指標はタブを出さない（直線の項目が無い会場）
 * - 展示が無い走を挟む区間は点線（gap）。前後に値が無い走は線を作らない
 * - 縦軸の範囲は6艇の値と会場平均を含み、値が無ければ null
 * - 今節の初戦（走が無い）は maxRuns が 0
 */
import assert from "node:assert/strict";
import {
  buildMeetFormTrend,
  domainOf,
  segmentsOf,
} from "../../src/components/race/meetFormTrend.js";

const players = [
  { number: 1, racerId: 11 },
  { number: 3, racerId: 33 },
];
const model = buildMeetFormTrend({
  players,
  trendByRacer: {
    11: [
      { raceId: "2026-10-10-22-04", boatNumber: 4, exhibitionTime: 6.91 },
      { raceId: "2026-10-11-22-11", boatNumber: 2, exhibitionTime: null },
      { raceId: "2026-10-12-22-06", boatNumber: 6, exhibitionTime: 6.92 },
    ],
    33: [{ raceId: "2026-10-10-22-04", boatNumber: 2, exhibitionTime: 6.88 }],
  },
  originalByKey: {
    "2026-10-10-22-04-4": { 一周: 37.63, まわり足: 5.4 },
    "2026-10-10-22-04-2": { 一周: "37.33", まわり足: 5.53 },
  },
  runsByRacer: {
    11: [
      { raceId: "2026-10-10-22-04", finish: 1 },
      { raceId: "2026-10-11-22-11", finish: "転" },
      { raceId: "2026-10-12-22-06", finish: 4 },
      // 走の集合に無いレースは無視する
      { raceId: "2026-10-13-22-11", finish: 1 },
    ],
    33: [{ raceId: "2026-10-10-22-04", finish: 2 }],
  },
  scopedByRacer: {
    11: [
      { raceId: "2026-10-10-22-04", actualCourse: 4 },
      { raceId: "2026-10-12-22-06", actualCourse: 5 },
    ],
    33: null,
  },
});

const b1 = model.boats[0];
assert.equal(b1.boat, 1);
assert.equal(b1.runs.length, 3, "走は今節展示情報の走だけ");
assert.deepEqual(
  b1.runs.map((r) => [r.date, r.raceNo, r.boatNumber, r.course, r.finish]),
  [
    ["2026-10-10", 4, 4, 4, 1],
    ["2026-10-11", 11, 2, null, "転"],
    ["2026-10-12", 6, 6, 5, 4],
  ],
);
assert.deepEqual(b1.runs[0].values, {
  exhibition: 6.91,
  lap: 37.63,
  turn: 5.4,
  straight: null,
});
// 3号艇は同じレースの別の艇番（2）の値を使う。1号艇の値（4号艇の行）が混ざらない
assert.equal(model.boats[1].runs[0].values.lap, 37.33, "文字列の値も数にする");
assert.equal(model.boats[1].runs[0].course, null, "進入の取得が無ければ null");
assert.deepEqual(model.metrics, ["exhibition", "lap", "turn"], "直線は値が無いのでタブを出さない");
assert.equal(model.maxRuns, 3);

assert.deepEqual(segmentsOf([6.91, null, 6.92]), [{ from: 0, to: 2, gap: true }]);
assert.deepEqual(segmentsOf([6.9, 6.8, null]), [{ from: 0, to: 1, gap: false }]);
assert.deepEqual(segmentsOf([null, 6.8]), []);

const d = domainOf([6.8, 6.9, null, 6.922]);
assert.ok(d.lo < 6.8 && d.hi > 6.922, "会場平均も範囲に入れる");
assert.equal(domainOf([null]), null);
const flat = domainOf([6.85]);
assert.ok(flat.hi - flat.lo > 0.02, "値が1つでも幅を持たせる");

const empty = buildMeetFormTrend({
  players,
  trendByRacer: { 11: [], 33: undefined },
  originalByKey: null,
  runsByRacer: null,
  scopedByRacer: {},
});
assert.equal(empty.maxRuns, 0, "今節の初戦はカードを出さない");
assert.deepEqual(empty.metrics, []);

console.log("verify-meet-form-trend: OK");
