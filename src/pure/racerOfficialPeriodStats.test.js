// buildRacerSummary（選手ページの最初の画面の要約、BOA-1688 R1）の単体試験。
// 回し方: node --test src/pure/racerOfficialPeriodStats.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRacerSummary } from "./racerOfficialPeriodStats.js";

const fCols = (fs) =>
  Object.fromEntries(fs.map((f, i) => [`c${i + 1}_f`, f]));

const row = (year, no, extra) => ({
  period_year: year,
  period_no: no,
  calc_from: `${year - 1}-11-01`,
  calc_to: `${year}-04-30`,
  win_rate: 6.5,
  top2_rate: 45.2,
  starts: 100,
  finals: 1,
  wins: 0,
  ...extra,
});

test("優出・優勝は全期の和、最初の期の呼び名はデータから組む", () => {
  const s = buildRacerSummary([
    row(2026, 2, { finals: 3, wins: 1 }),
    row(2019, 2, { finals: 2, wins: 2 }),
    row(2024, 1, { finals: 0, wins: 0 }),
  ]);
  assert.equal(s.finals, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.sinceLabel, "2019年後期");
});

test("最新の期は出走のある期のうち一番新しい期。値はその期の公式の値", () => {
  const s = buildRacerSummary([
    row(2026, 2, { starts: 0, win_rate: null, top2_rate: null }),
    row(2026, 1, {
      win_rate: 7.12,
      top2_rate: 55.3,
      starts: 146,
      finals: 4,
      wins: 2,
      calc_to: "2025-10-31",
    }),
  ]);
  assert.equal(s.label, "2026年前期");
  assert.equal(s.winRate, 7.12);
  assert.equal(s.top2Rate, 55.3);
  assert.equal(s.starts, 146);
  assert.equal(s.periodFinals, 4);
  assert.equal(s.periodWins, 2);
  assert.equal(s.dateModified, "2025-10-31");
});

test("F 数は最新の期のコース別 F の和。列が全部 NULL なら null", () => {
  const withF = buildRacerSummary([row(2026, 2, fCols([1, 0, null, 2, 0, 0]))]);
  assert.equal(withF.fCount, 3);
  const noCols = buildRacerSummary([row(2026, 2, {})]);
  assert.equal(noCols.fCount, null);
});

test("出走のある期が無ければ null", () => {
  assert.equal(buildRacerSummary([]), null);
  assert.equal(buildRacerSummary(null), null);
  assert.equal(buildRacerSummary([row(2026, 2, { starts: 0 })]), null);
});
