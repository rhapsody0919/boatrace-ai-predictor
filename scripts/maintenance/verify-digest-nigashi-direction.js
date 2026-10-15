#!/usr/bin/env node
/**
 * 「逃がしやすい選手」（nigashi）の向き（2026-10-15 修正）。
 * 逃がしは「その選手がいたレースで1号艇が逃げ切った割合」が期待より高い材料で、逃げと同じ「イン有利」側。
 * 以前は方向一致度・注目レースの理由文・ページの説明の3か所で「イン不利・荒れる要因」と逆に扱っていた。
 * あわせて、補正しているのは選手の級別ではなくレースグレードであること（文言）を固定する。DBには接続しない。
 *   node scripts/maintenance/verify-digest-nigashi-direction.js
 */
import assert from "node:assert/strict";
import { pickFeatured } from "../daily/generate-morning-digest.js";
import { computeConsistency } from "../../src/utils/digestMetrics.js";
import {
  MORNING_DIGEST_META,
  MORNING_DIGEST_SECTIONS,
} from "../../src/data/morningDigestCopy.js";

const nigashiRow = (volatility) => ({
  section: "nigashi",
  race_id: "2026-10-15-04-03",
  course: 2,
  metric_value: 80,
  metric_expected: 55,
  metric_skill_delta: 25,
  metric_venue_baseline: 55,
  sample_size: 40,
  volatility_percentile: volatility,
  detail: {},
});

const cases = [
  ["方向一致度: 逃がしは逃げと同じ向き（イン崩れ指数が低いほど一致）、まくりは逆", () => {
    assert.equal(computeConsistency("nigashi", 10), computeConsistency("nige", 10));
    assert.equal(computeConsistency("nigashi", 10), 0.9);
    assert.equal(computeConsistency("makuri", 10), 0.1);
  }],
  ["注目レース: イン崩れ指数が低いレースの逃がしが、高いレースの逃がしより先に選ばれる", () => {
    const low = nigashiRow(10);
    const high = { ...nigashiRow(90), race_id: "2026-10-15-04-02" };
    const featured = pickFeatured({ nige: [], makuri: [], nigashi: [high, low] });
    assert.equal(featured.race_id, low.race_id);
  }],
  ["注目レースの理由文: 逃がしは「イン有利」で、「イン不利」と書かない", () => {
    const featured = pickFeatured({ nige: [], makuri: [], nigashi: [nigashiRow(10)] });
    assert.equal(featured.detail.from, "nigashi");
    assert.match(featured.detail.reason, /「イン有利」方向/);
    assert.doesNotMatch(featured.detail.reason, /イン不利/);
  }],
  ["注目レースの理由文: まくりは今まで通り「イン不利」", () => {
    const makuri = { ...nigashiRow(90), section: "makuri", course: 4, metric_value: 30, metric_expected: 5 };
    const featured = pickFeatured({ nige: [], makuri: [makuri], nigashi: [] });
    assert.match(featured.detail.reason, /イン不利/);
  }],
  ["ページの説明: 逃がしを「荒れる要因」に入れず、「級別」で補正しているとは書かない", () => {
    const texts = [
      MORNING_DIGEST_META.description,
      MORNING_DIGEST_META.lead,
      ...MORNING_DIGEST_SECTIONS.map((s) => s.description),
    ];
    for (const t of texts) assert.doesNotMatch(t, /級別/, t);
    // 「荒れる要因」の括弧の中にあるのはまくりだけ
    const m = MORNING_DIGEST_META.description.match(/([^、（]*)（荒れる要因）/);
    assert.ok(m, "description に（荒れる要因）が無い");
    assert.doesNotMatch(m[1], /逃げられ/, m[1]);
    assert.match(m[1], /まくり/);
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
