#!/usr/bin/env node
// BOA-834: 最新の使用開始日だけで、入れ替え前のレースの順位まで消さない。
// verify-registry.json への登録は取り込み側で行う。
import assert from "node:assert/strict";
import { isVenueRankSnapshotBeforeGeneration } from "../../src/utils/motorGeneration.js";

const cases = [
  ["入れ替え当日の旧スナップショット", "2026-10-06", "2026-09-27", "2026-10-06", true],
  ["当日の新スナップショット", "2026-10-11", "2026-10-11", "2026-10-06", false],
  ["使用開始日と取得日が同日", "2026-10-06", "2026-10-06", "2026-10-06", false],
  ["入れ替え前のレース", "2026-09-30", "2026-09-27", "2026-10-06", false],
  ["使用開始日が不明", "2026-10-06", "2026-09-27", null, false],
  ["レース日が不明", null, "2026-09-27", "2026-10-06", false],
  ["取得日が不明", "2026-10-06", null, "2026-10-06", false],
  ["入れ替え後の旧スナップショット", "2026-10-11", "2026-09-27", "2026-10-06", true],
];
for (const [label, raceDate, scrapedDate, generationStart, expected] of cases) {
  assert.equal(
    isVenueRankSnapshotBeforeGeneration({ raceDate, scrapedDate, generationStart }),
    expected,
    label,
  );
  console.log(`OK ${label}`);
}
