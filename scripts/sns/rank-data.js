#!/usr/bin/env node
/**
 * 龍神ボート番付の元データ。DB・環境変数・外部通信は使わない。
 * node scripts/sns/rank-data.js --dataset=venue_kimarite
 * 期間・割合は会場ページの静的データをそのまま使う（--to は未対応）。
 */
import { VENUE_SUMMARY_STATS } from "../../src/data/venueSummaryStats.js";
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { venueSummaryPeriod } from "../../src/utils/venueSummary.js";

function venueKimarite() {
  const stats = VENUE_SUMMARY_STATS;
  const period = venueSummaryPeriod();
  const slugs = ["nige", "sashi", "makuri", "makurizashi", "nuki", "megumare"];
  return {
    dataset: "venue_kimarite",
    period: {
      from: stats.from,
      to: stats.to,
      label: `${period.from}〜${period.to}`,
    },
    scope: "12m",
    unit: "venue",
    value_type: "rate",
    rows: Object.entries(stats.venues).flatMap(([code, venue]) =>
      slugs.map((slug) => ({
        name: STADIUM_NAMES[code],
        k: venue.techniques[slug].count,
        n: venue.races,
        value: venue.techniques[slug].rate,
        extra: {
          venue_code: Number(code),
          technique: slug,
          vs_national: venue.vsNational[slug] ?? null,
          national_rate: stats.national.techniques[slug].rate,
        },
      })),
    ),
    baseline: null,
    observed_at: new Date().toISOString(),
    source_sha: stats.sourceSha256,
  };
}

const datasets = new Map([["venue_kimarite", venueKimarite]]);
try {
  let dataset;
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--dataset=")) {
      throw new Error(`未対応の引数: ${arg}（期間は会場ページの静的データと同じです）`);
    }
    if (dataset !== undefined) throw new Error("--dataset は1つだけ指定してください");
    dataset = arg.slice("--dataset=".length);
  }
  if (!dataset) throw new Error("--dataset=<id> を指定してください");
  const build = datasets.get(dataset);
  if (!build) throw new Error(`未対応の dataset: ${dataset}`);
  console.log(JSON.stringify(build()));
} catch (error) {
  console.error(`rank-data: ${error.message}`);
  process.exitCode = 1;
}
