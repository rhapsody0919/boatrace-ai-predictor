#!/usr/bin/env node
/** BOA-1240: 会場ページと番付データの一致を、DB・通信なしで確認する。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VENUE_SUMMARY_STATS as S } from "../../src/data/venueSummaryStats.js";
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { venueSummaryPeriod } from "../../src/utils/venueSummary.js";

const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const run = (args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: "utf8",
  timeout: 10000,
});
const result = run(["--dataset=venue_kimarite"]);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stderr, "");
const data = JSON.parse(result.stdout);
assert.deepEqual(Object.keys(data).sort(), [
  "dataset", "period", "scope", "unit", "value_type", "rows", "baseline",
  "observed_at", "source_sha",
].sort());
assert.equal(data.dataset, "venue_kimarite");
const period = venueSummaryPeriod();
assert.deepEqual(data.period, {
  from: S.from,
  to: S.to,
  label: `${period.from}〜${period.to}`,
});
assert.equal(data.scope, "12m");
assert.equal(data.unit, "venue");
assert.equal(data.value_type, "rate");
assert.equal(data.baseline, null);
assert.equal(data.source_sha, S.sourceSha256);
assert.equal(new Date(data.observed_at).toISOString(), data.observed_at);

const slugs = ["nige", "sashi", "makuri", "makurizashi", "nuki", "megumare"];
assert.equal(data.rows.length, 144);
const seen = new Set();
for (const row of data.rows) {
  const { venue_code: code, technique: slug } = row.extra;
  assert.ok(Number.isInteger(code) && code >= 1 && code <= 24);
  assert.ok(slugs.includes(slug));
  const key = `${code}:${slug}`;
  assert.ok(!seen.has(key), `重複: ${key}`);
  seen.add(key);
  const venue = S.venues[code];
  assert.deepEqual(row, {
    name: STADIUM_NAMES[code],
    k: venue.techniques[slug].count,
    n: venue.races,
    value: venue.techniques[slug].rate,
    extra: {
      venue_code: code,
      technique: slug,
      vs_national: venue.vsNational[slug] ?? null,
      national_rate: S.national.techniques[slug].rate,
    },
  });
  assert.ok(Number.isInteger(row.k) && row.k >= 0 && row.k <= row.n);
}
// 桐生の逃げも、画面のカードが直接読む同じ定数と照合（要約文では逃げを省く）。
const kiryu = data.rows.find((r) => r.extra.venue_code === 1 && r.extra.technique === "nige");
assert.deepEqual([kiryu.k, kiryu.value], [S.venues[1].techniques.nige.count, S.venues[1].techniques.nige.rate]);

for (const args of [
  ["--dataset=unknown"],
  ["--dataset=toString"],
  [],
  ["--dataset="],
  ["--dataset", "venue_kimarite"],
  ["--dataset=venue_kimarite", "--to=2026-11-02"],
  ["--dataset=venue_kimarite", "--unknown"],
  ["--dataset=venue_kimarite", "--dataset=venue_kimarite"],
]) {
  const rejected = run(args);
  assert.equal(rejected.status, 1, JSON.stringify(args));
  assert.equal(rejected.stdout, "");
  assert.ok(rejected.stderr.trim().length > 0, "拒否の理由をstderrに出す");
}
console.log("✅ verify-sns-rank-data: 144行・画面の定数との一致・引数の拒否を確認");
