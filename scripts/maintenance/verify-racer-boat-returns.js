#!/usr/bin/env node
// 選手ページの枠番別回収率（src/pure/racerBoatReturns.js）が、絞り込み・着順の付かない走・払戻の積み方・通算の推移を正しく数えることを守る
import assert from "node:assert/strict";
import { boatReturnRows, boatReturnSeries, BIG_WIN_PAYOUT } from "../../src/pure/racerBoatReturns.js";

const run = (raceId, boatNumber, over = {}) => ({
  raceId,
  venueCode: 1,
  raceGrade: "ippan",
  raceStage: null,
  boatNumber,
  rank1: 1,
  rank2: 2,
  payoutWin: 0,
  payoutPlace1: 0,
  payoutPlace2: 0,
  unranked: false,
  ...over,
});
const ALL = { venueCode: null, boatNumber: null, raceGrade: null, raceStage: null };

const history = [
  // 1号艇: 1着（単勝150・複勝110）、2着（複勝の2着側 130）、着外
  run("2026-01-01-01-01", 1, { rank1: 1, payoutWin: 150, payoutPlace1: 110 }),
  run("2026-01-02-01-01", 1, { rank1: 3, rank2: 1, payoutPlace2: 130 }),
  run("2026-01-03-02-01", 1, { rank1: 2, rank2: 3, venueCode: 2 }),
  // 6号艇: 大きな1着（単勝 5,010円）と、F で着順が付かない走（rank1 に入っていても払戻なし）
  run("2026-01-04-01-01", 6, { rank1: 6, payoutWin: 5010, payoutPlace1: 1200 }),
  run("2026-01-05-01-01", 6, { rank1: 6, payoutWin: 900, payoutPlace1: 300, unranked: true }),
];

// 表: 絞り込みなしは6行。走が無い枠番は0走で率は null
const rows = boatReturnRows(history, ALL);
assert.equal(rows.length, 6);
const b1 = rows.find((r) => r.boat === 1);
assert.deepEqual([b1.n, b1.wins], [3, 1]);
assert.equal(b1.winReturn, (150 / 300) * 100);
assert.equal(b1.placeReturn, ((110 + 130) / 300) * 100);
const b6 = rows.find((r) => r.boat === 6);
assert.deepEqual([b6.n, b6.wins], [2, 1], "着順の付かない走は走数に入るが1着に数えない");
assert.equal(b6.winReturn, (5010 / 200) * 100);
assert.deepEqual(rows.find((r) => r.boat === 3), { boat: 3, n: 0, wins: 0, winReturn: null, placeReturn: null, topWinShare: null });
assert.equal(b1.topWinShare, 1, "1着が1回なら最大の1回が全部");
assert.equal(b6.topWinShare, 1);

// 表: 会場で絞る・枠番を固定すると、その行だけ・その走だけ
const venue2 = boatReturnRows(history, { ...ALL, venueCode: 2 });
assert.equal(venue2.find((r) => r.boat === 1).n, 1);
const fixed = boatReturnRows(history, { ...ALL, boatNumber: 6 });
assert.deepEqual(fixed.map((r) => r.boat), [6]);

// 推移: 各走の時点までの通算。大きな単勝の走に印
const s1 = boatReturnSeries(history, ALL, 1);
assert.deepEqual(s1.map((p) => p.date), ["01/01", "01/02", "01/03"]);
assert.deepEqual(s1.map((p) => p.n), [1, 2, 3], "各点に何走目かを持つ");
assert.deepEqual(s1.map((p) => Math.round(p.win)), [150, 75, 50]);
assert.deepEqual(s1.map((p) => Math.round(p.place)), [110, 120, 80]);
const s6 = boatReturnSeries(history, ALL, 6);
assert.equal(s6[0].bigWin, 5010);
assert.ok(5010 >= BIG_WIN_PAYOUT);
assert.equal(s6[1].bigWin, null, "着順の付かない走に印を付けない");
assert.equal(Math.round(s6[1].win), Math.round((5010 / 200) * 100));

console.log("verify-racer-boat-returns: OK");
