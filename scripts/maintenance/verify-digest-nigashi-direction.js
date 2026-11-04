#!/usr/bin/env node
/**
 * 「逃がしやすい選手」（nigashi）は注目レースの点（方向一致度）に入れない（2026-11-04 オーナー決定）。
 * 根拠: 抽出に当たったレースの1号艇の1着は外れと同じ 56.0% 対 56.0%（PR #2243、
 * data/analysis/nigashi-makurare/today-nigashi-hit.json）。一覧の区画そのものは残す。
 * （2026-10-15 に向きを「イン有利」へ直した経緯は、ページの説明の固定として下に残す。）
 * あわせて、補正しているのは選手の級別ではなくレースグレードであること（文言）を固定する。DBには接続しない。
 *   node scripts/maintenance/verify-digest-nigashi-direction.js
 */
import assert from "node:assert/strict";
import { pickFeatured } from "../daily/generate-morning-digest.js";
import { computeConsistency, computeFeaturedScore } from "../../src/utils/digestMetrics.js";
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
  ["方向一致度: 逃げはイン崩れ指数が低いほど一致、まくりは逆、逃がしは持たない（null）", () => {
    assert.equal(computeConsistency("nige", 10), 0.9);
    assert.equal(computeConsistency("makuri", 10), 0.1);
    assert.equal(computeConsistency("nigashi", 10), null);
    assert.equal(computeConsistency("nigashi", 90), null);
  }],
  ["注目レースの点: 逃がしだけが当たるレースは点が付かず、候補に入らない", () => {
    assert.equal(
      computeFeaturedScore({ metric: "nigashi", rate: 80, expected: 55, n: 40, volatilityPercentile: 10 }),
      null,
    );
    assert.equal(pickFeatured({ nige: [], makuri: [], nigashi: [nigashiRow(10)] }), null);
  }],
  ["注目レース: 逃がしがどれだけ強くても、点の低い逃げ・まくりが選ばれる", () => {
    const nige = {
      ...nigashiRow(50), section: "nige", race_id: "2026-10-15-05-01", course: 1,
      metric_value: 55, metric_expected: 53,
    };
    const featured = pickFeatured({ nige: [nige], makuri: [], nigashi: [nigashiRow(0)] });
    assert.equal(featured.race_id, nige.race_id);
    assert.equal(featured.detail.from, "nige");
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
