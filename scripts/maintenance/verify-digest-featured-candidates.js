#!/usr/bin/env node
/**
 * 注目レースを表示上限前の逃げ候補から選ぶ（BOA-851）。
 * イン崩れ注意度の3列と、注目レースを注意度で選ぶ切り替え（BOA-822 task 33、MORNING_DIGEST_IN_CAUTION）。
 * 156 が未適用の DB では注意度の列だけを除いて書く（131 の motor_race_count は書き続ける）。
 * pickFeatured 等の純関数テスト。DBには接続しない。
 *   node scripts/maintenance/verify-digest-featured-candidates.js
 */
import assert from "node:assert/strict";
import {
  insertWithOptionalColumnGroups,
  pickFeatured,
} from "../daily/generate-morning-digest.js";
import { inCautionColumns } from "../lib/morningDigestParts.js";
import { MORNING_DIGEST_IN_CAUTION } from "../lib/morningDigestSummary.js";
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

// --- BOA-822 task 33: 注意度 ---
// 同じ成績の逃げ2件。A は指数が低い（イン有利）が注意度は崩れやすい、B はその逆
const nigeA = {
  ...nige[0],
  race_id: "2026-10-13-01-05",
  volatility_percentile: 10,
  in_caution_pct: 90,
  in_caution_n: 3000,
  in_caution_level: "high",
};
const nigeB = {
  ...nige[0],
  race_id: "2026-10-13-02-05",
  volatility_percentile: 90,
  in_caution_pct: 10,
  in_caution_n: 3000,
  in_caution_level: "low",
};
const cautionSections = { nige: [nigeA, nigeB], makuri: [], nigashi: [] };
const conflictError = (column) => ({
  code: "PGRST204",
  message: `Could not find the '${column}' column of 'morning_digest_rows' in the schema cache`,
});
cases.push(
  ["公開までは定数が false（注目レースは旧の指数のまま）", () => {
    assert.equal(MORNING_DIGEST_IN_CAUTION, false);
    assert.deepEqual(
      pickFeatured(cautionSections),
      pickFeatured(cautionSections, { useInCaution: false }),
    );
  }],
  ["注意度で選ぶと、注意度の値で方向一致度を出し、理由文も注意度で書く", () => {
    const featured = pickFeatured(cautionSections, { useInCaution: true });
    assert.equal(featured.race_id, nigeB.race_id);
    assert.match(featured.detail.reason, /イン崩れ注意度は10%（1号艇と、他の艇で一番高い全国勝率の差が同じくらいの全国の過去レース3,000件で/);
    assert.doesNotMatch(featured.detail.reason, /イン崩れ指数/);
    const legacy = pickFeatured(cautionSections, { useInCaution: false });
    assert.equal(legacy.race_id, nigeA.race_id);
    assert.match(legacy.detail.reason, /イン崩れ指数は10%/);
  }],
  ["注意度が全レース null の日は、注意度で選ぶと注目レースは0件", () => {
    const empty = {
      nige: [nigeA, nigeB].map((r) => ({ ...r, ...inCautionColumns(null) })),
      makuri: [],
      nigashi: [],
    };
    assert.equal(pickFeatured(empty, { useInCaution: true }), null);
    assert.notEqual(pickFeatured(empty, { useInCaution: false }), null);
  }],
  ["inCautionColumns は値の無いときも3列のキーを持つ", () => {
    assert.deepEqual(inCautionColumns(null), {
      in_caution_pct: null,
      in_caution_n: null,
      in_caution_level: null,
    });
    assert.deepEqual(inCautionColumns({ pct: 65, n: 34842, level: "high" }), {
      in_caution_pct: 65,
      in_caution_n: 34842,
      in_caution_level: "high",
    });
  }],
);

const asyncCases = [
  ["156 が未適用なら注意度の3列だけ除き、motor_race_count は書き続ける（以降のバッチも）", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      race_id: `r${i}`,
      motor_race_count: 3,
      ...inCautionColumns({ pct: 50, n: 100, level: "mid" }),
    }));
    const calls = [];
    const skipped = await insertWithOptionalColumnGroups(async (chunk) => {
      calls.push(chunk);
      if ("in_caution_pct" in chunk[0]) return { error: conflictError("in_caution_pct") };
      return { error: null };
    }, rows);
    assert.deepEqual(skipped, ["マイグレーション156"]);
    assert.equal(calls.length, 3); // 1回目の失敗・書き直し・2つ目のバッチ
    assert.deepEqual(calls.slice(1).map((c) => c.length), [200, 50]);
    for (const chunk of calls.slice(1)) {
      assert.ok(chunk.every((r) => r.motor_race_count === 3 && !("in_caution_level" in r)));
    }
  }],
  ["列の不在でないエラーは投げる（黙って列を落とさない）", async () => {
    await assert.rejects(
      insertWithOptionalColumnGroups(async () => ({
        error: { code: "23505", message: "duplicate key in_caution_pct" },
      }), [{ race_id: "r1" }]),
      (error) => error.code === "23505",
    );
  }],
];

let failed = 0;
for (const [name, run] of asyncCases) {
  try {
    await run();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[NG] ${name}: ${error.message}`);
  }
}
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
