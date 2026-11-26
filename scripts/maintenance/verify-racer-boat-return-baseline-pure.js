// 選手ページの純関数（枠番別回収率・3連単の着順の合計）が、回収率の基準の試験データの期待する合計を返すことを守る（SQL 側は verify-racer-boat-return-baseline.js）
import assert from "node:assert/strict";
import { boatReturnRows } from "../../src/pure/racerBoatReturns.js";
import { trifectaInvolvementRows } from "../../src/pure/racerTrifectaInvolvement.js";
import { RACES, EXPECTED, historyRows } from "./verifyData/racer-boat-return-baseline.js";

const history = historyRows();
const payouts = Object.fromEntries(RACES.map((r) => [r.id, r.trio]));
const all = { venueCode: null, boatNumber: null, raceGrade: null, raceStage: null };
const rows = boatReturnRows(history, all);

for (const e of EXPECTED) {
  const row = rows.find((r) => r.boat === e.boat);
  assert.equal(row.n, e.runs, `${e.boat}号艇の走数`);
  assert.equal(Math.round(row.winReturn * row.n), e.win_sum, `${e.boat}号艇の単勝の合計`);
  assert.equal(Math.round(row.placeReturn * row.n), e.place_sum, `${e.boat}号艇の複勝の合計`);
  const tri = trifectaInvolvementRows(history, { ...all, boatNumber: e.boat }, payouts);
  for (const k of [1, 2, 3]) {
    const t = tri.rows.find((x) => x.key === k);
    assert.equal(Math.round(t.perRun * tri.runs), e[`tri_pos${k}_sum`], `${e.boat}号艇の3連単 ${k}着の合計`);
  }
}

console.log("verify-racer-boat-return-baseline-pure: OK");
