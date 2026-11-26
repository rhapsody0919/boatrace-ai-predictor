#!/usr/bin/env node
// 選手ページの「3着以内のレースの3連単配当」（src/pure/racerTrifectaInvolvement.js）の着順の振り分け・1走あたり配当・中央値・万舟・通算の推移を守る
import assert from "node:assert/strict";
import {
  trifectaInvolvementRows,
  trifectaInvolvementSeries,
  MANSHU_PAYOUT,
} from "../../src/pure/racerTrifectaInvolvement.js";

const payouts = {};
const run = (raceId, ranks, payout, over = {}) => {
  payouts[raceId] = payout;
  return {
    raceId,
    venueCode: 1,
    raceGrade: "ippan",
    raceStage: null,
    boatNumber: 4,
    rank1: ranks[0],
    rank2: ranks[1],
    rank3: ranks[2],
    unranked: false,
    ...over,
  };
};
const ALL = { venueCode: null, boatNumber: null, raceGrade: null, raceStage: null };

const history = [
  run("2026-01-01-01-01", [4, 1, 2], 2000), // 1着
  run("2026-01-02-01-01", [1, 4, 2], 1500), // 2着
  run("2026-01-03-01-01", [1, 2, 4], 30000), // 3着・万舟
  run("2026-01-04-01-01", [1, 2, 4], 5000), // 3着
  run("2026-01-05-01-01", [1, 2, 3], 900), // 着外（選手の配当にしない）
  run("2026-01-06-01-01", [4, 1, 2], 800, { unranked: true }), // F 等で着順が付かない走は3着以内に数えない
  run("2026-01-07-02-01", [1, 2, 4], null, { venueCode: 2 }), // 3着だが配当が無い走
];

const { runs, rows } = trifectaInvolvementRows(history, ALL, payouts);
assert.equal(runs, 7);
const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
assert.equal(byKey[1].count, 1);
assert.deepEqual(byKey[1].values, [2000], "2回以下は値そのもの");
assert.equal(byKey[1].median, null);
assert.equal(byKey[2].count, 1);
assert.equal(byKey[3].count, 3, "配当の無い走も回数に入れる");
assert.equal(byKey[3].median, null, "配当のある走が2回なら中央値でなく値");
assert.deepEqual(byKey[3].values, [30000, 5000]);
assert.equal(byKey[3].manshu, 1);
assert.equal(byKey.all.count, 5);
assert.equal(byKey.all.perRun, (2000 + 1500 + 30000 + 5000) / 7, "1走あたり配当の分母は絞り込みに合う全ての出走");
assert.equal(byKey.all.median, (2000 + 5000) / 2, "全体は4件の中央値");
assert.equal(byKey.all.manshu, 1);
assert.ok(30000 >= MANSHU_PAYOUT);

// 会場で絞ると分母も絞った走だけ
const v2 = trifectaInvolvementRows(history, { ...ALL, venueCode: 2 }, payouts);
assert.equal(v2.runs, 1);
assert.equal(v2.rows.find((r) => r.key === 3).count, 1);

// 推移: 各走の時点までの通算。引き始めの走より前は出さない
const s = trifectaInvolvementSeries(history, ALL, payouts, 3);
assert.deepEqual(s.map((p) => p.date), ["01/03", "01/04", "01/05", "01/06", "01/07"]);
assert.equal(s[0].value, (2000 + 1500 + 30000) / 3);
assert.equal(s[0].manshu, 30000);
assert.equal(s[1].manshu, null);
assert.equal(s[4].value, (2000 + 1500 + 30000 + 5000) / 7);

console.log("verify-racer-trifecta-involvement: OK");
