// 選手ページの履歴の窓（src/pure/racerHistoryWindow.js）が racerHistoryCutoff と同じ730日前を返し、窓を月の境で隙間なく分けることを守る
import assert from "node:assert/strict";
import { monthRanges, racerHistoryWindowStart, addDaysIso, RACER_HISTORY_DAYS } from "../../src/pure/racerHistoryWindow.js";

assert.equal(RACER_HISTORY_DAYS, 730);
assert.equal(racerHistoryWindowStart(new Date("2026-11-27T00:00:00Z")), "2024-11-27", "選手ページの racerHistoryCutoff と同じ730日前");
assert.equal(racerHistoryWindowStart(new Date("2024-03-01T00:00:00Z")), "2022-03-02", "うるう日（2024-02-29）をまたぐと暦の2年より1日短い");
assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
assert.equal(addDaysIso("2024-02-28", 1), "2024-02-29");

assert.deepEqual(monthRanges("2025-11-27", "2026-02-10"), [
  ["2025-11-27", "2025-11-30"],
  ["2025-12-01", "2025-12-31"],
  ["2026-01-01", "2026-01-31"],
  ["2026-02-01", "2026-02-10"],
]);
assert.deepEqual(monthRanges("2026-02-01", "2026-02-28"), [["2026-02-01", "2026-02-28"]], "うるう年でない2月");
assert.deepEqual(monthRanges("2024-02-01", "2024-02-29"), [["2024-02-01", "2024-02-29"]], "うるう年の2月");
assert.deepEqual(monthRanges("2026-03-05", "2026-03-04"), [], "空の窓");
assert.deepEqual(monthRanges("2026-03-05", "2026-03-05"), [["2026-03-05", "2026-03-05"]], "1日だけ");

// 窓全体（730日）を分けると、隙間も重なりもなく両端が合う
const parts = monthRanges("2024-11-27", "2026-11-26");
assert.equal(parts[0][0], "2024-11-27");
assert.equal(parts.at(-1)[1], "2026-11-26");
for (let i = 1; i < parts.length; i += 1) assert.equal(parts[i][0], addDaysIso(parts[i - 1][1], 1), `${i} 番目の始まり`);

console.log("verify-racer-history-window: OK");
