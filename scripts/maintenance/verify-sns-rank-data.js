#!/usr/bin/env node
/** BOA-1240: 会場ページと番付データの一致を、DB・通信なしで確認する。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WIND_BINS } from "../analysis/analyze-weather-in-escape.js";
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

// 画面の下限をソースから照合し、公開JSONの値・除外・並びを全件確認する。
const weather = JSON.parse(readFileSync(new URL("../../public/data/weather-in-escape.json", import.meta.url), "utf8"));
const chart = readFileSync(new URL("../../src/components/analysis/WeatherInEscapeChart.jsx", import.meta.url), "utf8");
const minMatch = chart.match(/const SHOW_MIN_N = (\d+);/);
assert.ok(minMatch, "画面の SHOW_MIN_N を読み取れる");
const minN = Number(minMatch[1]);
const weatherResult = run(["--dataset=venue_in_by_weather"]);
assert.equal(weatherResult.status, 0, weatherResult.stderr);
assert.equal(weatherResult.stderr, "");
const output = JSON.parse(weatherResult.stdout);
assert.equal(output.dataset, "venue_in_by_weather");
assert.deepEqual(output.period, {
  ...weather.period,
  label: `${weather.period.from.slice(0, 7).replace("-", "/")}〜${weather.period.to.slice(0, 7).replace("-", "/")}`,
});
assert.equal(output.scope, "archive");
assert.equal(output.unit, "venue");
assert.equal(output.value_type, "rate");
assert.equal(output.source_sha, weather.inputHash);
assert.equal(new Date(output.observed_at).toISOString(), output.observed_at);
assert.deepEqual(output.baseline, { label: "全国の1コース1着率", value: weather.overallInWinRate });
let expectedCount = 0;
const excluded = [];
for (const bin of ["head_strong", "tail_strong"]) {
  const entries = Object.entries(weather.venues);
  const eligible = entries.filter(([, v]) => (v.bins[bin]?.n ?? 0) >= minN)
    .sort((a, b) => a[1].bins[bin].diff - b[1].bins[bin].diff);
  const rows = output.rows.filter((r) => r.extra.bin === bin);
  expectedCount += eligible.length;
  assert.deepEqual(rows, eligible.map(([code, v]) => ({
    name: STADIUM_NAMES[code], k: null, n: v.bins[bin].n, value: v.bins[bin].rate,
    extra: {
      venue_code: Number(code), bin, label: WIND_BINS.find((b) => b.key === bin).label,
      diff: v.bins[bin].diff, venue_rate: v.rate,
    },
  })));
  excluded.push({ bin, names: entries.filter(([, v]) => (v.bins[bin]?.n ?? 0) < minN).map(([code]) => STADIUM_NAMES[code]) });
}
assert.equal(output.rows.length, expectedCount, "強風2区分のみ（波を含まない）");
assert.ok(output.rows.every((r) => r.n >= minN));
assert.deepEqual(output.excluded, excluded);
const kiryuTail = output.rows.find((r) => r.extra.venue_code === 1 && r.extra.bin === "tail_strong");
assert.ok(kiryuTail);
assert.deepEqual([kiryuTail.n, kiryuTail.value], [weather.venues[1].bins.tail_strong.n, weather.venues[1].bins.tail_strong.rate]);
console.log(`✅ verify-sns-rank-data: 強風2区分 ${expectedCount}行・画面の下限・JSON全件一致・除外を確認`);
