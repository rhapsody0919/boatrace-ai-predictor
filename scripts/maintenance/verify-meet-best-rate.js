/**
 * verify-meet-best-rate.js — 今節タブの得点率の金枠の候補（BOA-872）の回帰テスト。
 *
 * 対象は `src/pure/seriesPoints.js` の `meetRateBestCandidates`（`bestOf` に渡す候補）。
 * 公式の途中帰郷（officialWithdrawn）の得点率は画面で「—」になる（#1953）。比べる値に
 * 残すと、その選手の得点率が6艇で最も高いとき「—」のセルが最良として光るか（`hidden`
 * にした場合）、本来の最良の艇に金枠が付かない。途中帰郷を候補から外し、表に数字が
 * 出ている艇の中の最良に金枠を付ける。
 *
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import { bestOf } from "../../src/utils/bestOf.js";
import {
  meetRateBestCandidates,
  MEET_SMALL_SAMPLE_RUNS,
} from "../../src/pure/seriesPoints.js";

let count = 0;
const check = (name, fn) => {
  fn();
  count += 1;
  console.log(`  ok ${name}`);
};

const row = (boat, rate, runs, excludedReason = null) => ({
  boat,
  row: { rate, runs, excludedReason },
});
const best = (rows) =>
  [...bestOf(meetRateBestCandidates(rows), "max", { digits: 2 })].sort(
    (a, b) => a - b,
  );

check(
  "公式の途中帰郷が最も高くても、表に出ている艇の最良に金枠を付ける",
  () => {
    const rows = [
      row(1, 6.0, 4),
      row(2, 9.0, 4, "officialWithdrawn"),
      row(3, 8.0, 4),
      row(4, 7.0, 4),
    ];
    assert.deepEqual(best(rows), [3]);
  },
);

check(
  "修正前の候補（rate をそのまま比べる）では金枠が途中帰郷へ行く（歯の確認）",
  () => {
    const rows = [
      row(2, 9.0, 4, "officialWithdrawn"),
      row(3, 8.0, 4),
      row(4, 7.0, 4),
    ];
    const before = rows.map(({ boat, row: r }) => ({
      boat,
      value: r.rate,
      hidden: r.runs < MEET_SMALL_SAMPLE_RUNS,
    }));
    assert.deepEqual([...bestOf(before, "max", { digits: 2 })], [2]);
    assert.deepEqual(best(rows), [3]);
  },
);

check(
  "途中帰郷（推定、withdrawn）は今までどおり比べる（「—」にしないため）",
  () => {
    const rows = [row(1, 9.0, 4, "withdrawn"), row(2, 8.0, 4)];
    assert.deepEqual(best(rows), [1]);
  },
);

check("走数が少ない艇は比べるが光らせない（繰り下げない）は変えない", () => {
  const rows = [row(1, 10.0, MEET_SMALL_SAMPLE_RUNS - 1), row(2, 8.0, 4)];
  assert.deepEqual(best(rows), []);
});

check("途中帰郷を外すと残りが全艇同値なら金枠なし", () => {
  const rows = [
    row(1, 9.0, 4, "officialWithdrawn"),
    row(2, 7.0, 4),
    row(3, 7.0, 4),
  ];
  assert.deepEqual(best(rows), []);
});

console.log(`✅ meetBestRate: ${count} 件の例を確認`);
