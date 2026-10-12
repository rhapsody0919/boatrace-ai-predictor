#!/usr/bin/env node
/**
 * 注目レースを表示上限前の逃げ候補から選ぶ（BOA-851）。
 * pickFeatured の純関数テスト。DBには接続しない。
 *   node scripts/maintenance/verify-digest-featured-candidates.js
 */
import assert from "node:assert/strict";
import { pickFeatured } from "../daily/generate-morning-digest.js";
import { computeFeaturedScore } from "../../src/utils/digestMetrics.js";

const nige = Array.from({ length: 25 }, (_, i) => ({
  section: "nige",
  race_id: `2026-10-13-${String(i + 1).padStart(2, "0")}-01`,
  course: 1,
  metric_value: 80,
  metric_expected: 50,
  metric_skill_delta: 30,
  metric_venue_baseline: 50,
  sample_size: 100,
  volatility_percentile: 90,
  detail: {},
}));
const beyondLimit = {
  ...nige[0],
  race_id: "2026-10-13-24-02",
  metric_value: 75,
  metric_skill_delta: 25,
  volatility_percentile: 5,
};
const nigeAll = [...nige, beyondLimit];
const score = (r) => computeFeaturedScore({
  metric: r.section,
  rate: r.metric_value,
  expected: r.metric_expected,
  n: r.sample_size,
  volatilityPercentile: r.volatility_percentile,
});
assert.ok(nige.every((r) => score(beyondLimit) > score(r)));
const sections = { nige, nigeAll, makuri: [], nigashi: [] };
const before = structuredClone(sections);
const cases = [
  ["26件目が注目レースになる", () => {
    const featured = pickFeatured(sections);
    assert.equal(featured.race_id, beyondLimit.race_id);
    assert.equal(featured.section, "featured");
    assert.equal(featured.detail.from, "nige");
  }],
  ["nigeAll が無い呼び出しは nige にフォールバック", () => {
    const legacy = pickFeatured({ nige, makuri: [], nigashi: [] });
    assert.equal(legacy.race_id, nige[0].race_id);
    assert.deepEqual(legacy, pickFeatured({ ...sections, nigeAll: nige }));
  }],
  ["入力の表示用25件と全候補を書き換えない", () => {
    assert.deepEqual(sections, before);
    assert.equal(nige.length, 25);
  }],
];
let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[NG] ${name}: ${error.message}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通りました");
