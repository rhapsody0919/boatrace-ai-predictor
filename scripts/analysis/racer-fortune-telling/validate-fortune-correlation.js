// 占術スコアと実績データ(複勝圏内・ST)の相関検証
// racer_profiles(生年月日) × race_entries(racer_id) × race_results(着順) × race_start_timings(ST)
// を結合し、4占術それぞれについて検証結果を data/analysis/racer-fortune-telling/ に保存する
//
// 使用方法:
//   node scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js
//   node scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js --limit=1000

import fs from "fs";
import path from "path";
import { supabase } from "../../lib/supabaseClient.js";
import { extractDateFromRaceId } from "../../lib/dateUtils.js";
import { FORTUNE_SYSTEMS } from "../../lib/fortuneTelling/index.js";
import {
  pearsonCorrelation,
  pearsonPValue,
  proportionZTest,
} from "../../lib/statisticalTests.js";

const REPORT_DIR = "data/analysis/racer-fortune-telling";
const PAGE_SIZE = 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { limit: null };
  for (const arg of args) {
    if (arg.startsWith("--limit="))
      options.limit = parseInt(arg.replace("--limit=", ""), 10);
  }
  return options;
}

async function fetchAllPages(table, select, applyFilters = (q) => q) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await applyFilters(
      supabase.from(table).select(select).order(select.split(",")[0].trim()),
    ).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}取得エラー: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const options = parseArgs();

  console.log("=== 占術スコア相関検証 ===");
  console.log("");

  console.log("racer_profiles 取得中...");
  const profiles = await fetchAllPages(
    "racer_profiles",
    "racer_id, birth_date",
  );
  const birthDateMap = new Map(profiles.map((p) => [p.racer_id, p.birth_date]));
  console.log(`  ${birthDateMap.size}件`);

  console.log("race_results 取得中...");
  const results = await fetchAllPages(
    "race_results",
    "race_id, rank1, rank2, rank3",
  );
  const resultMap = new Map(results.map((r) => [r.race_id, r]));
  console.log(`  ${resultMap.size}件`);

  console.log("race_start_timings 取得中...");
  const timings = await fetchAllPages(
    "race_start_timings",
    "race_id, boat_number, start_timing",
  );
  const timingMap = new Map(
    timings.map((t) => [`${t.race_id}_${t.boat_number}`, t.start_timing]),
  );
  console.log(`  ${timingMap.size}件`);

  console.log("race_entries 取得中...");
  let entries = await fetchAllPages(
    "race_entries",
    "race_id, boat_number, racer_id",
    (q) => q.not("racer_id", "is", null),
  );
  console.log(`  ${entries.length}件`);
  if (options.limit) entries = entries.slice(0, options.limit);

  // racer_profilesに生年月日がある選手のみ対象
  const targetEntries = entries.filter((e) => birthDateMap.has(e.racer_id));
  console.log(`検証対象エントリ数: ${targetEntries.length}件`);
  console.log("");

  // 占術ごとに { score, isPlaceHit, startTiming } の配列を構築
  const rowsBySystem = new Map(FORTUNE_SYSTEMS.map((s) => [s.id, []]));

  for (const entry of targetEntries) {
    const birthDate = birthDateMap.get(entry.racer_id);
    const targetDate = extractDateFromRaceId(entry.race_id);

    const result = resultMap.get(entry.race_id);
    const isPlaceHit = result
      ? [result.rank1, result.rank2, result.rank3].includes(entry.boat_number)
      : null;

    const startTiming =
      timingMap.get(`${entry.race_id}_${entry.boat_number}`) ?? null;

    for (const system of FORTUNE_SYSTEMS) {
      const { score } = system.calculateScore(birthDate, targetDate);
      rowsBySystem.get(system.id).push({ score, isPlaceHit, startTiming });
    }
  }

  const report = {
    executedAt: new Date().toISOString(),
    targetEntryCount: targetEntries.length,
    targetRacerCount: new Set(targetEntries.map((e) => e.racer_id)).size,
    systems: {},
  };

  for (const system of FORTUNE_SYSTEMS) {
    const rows = rowsBySystem.get(system.id);

    // 複勝圏内フラグとの検証: スコアの離散値ごとにグループ化し、全体の複勝率をベースラインに
    // 各グループの複勝率が有意に異なるかをz検定する(4占術のscoreはいずれも5〜7段階の離散値のため、
    // 分位点による人為的な区切りではなく、実際のスコア値そのものでグループ化する)
    const placeRows = rows.filter((r) => r.isPlaceHit !== null);
    const baselineHits = placeRows.filter((r) => r.isPlaceHit).length;
    const baselineRate =
      placeRows.length > 0 ? baselineHits / placeRows.length : null;

    const scoreGroups = new Map();
    for (const row of placeRows) {
      if (!scoreGroups.has(row.score))
        scoreGroups.set(row.score, { hits: 0, total: 0 });
      const g = scoreGroups.get(row.score);
      g.total += 1;
      if (row.isPlaceHit) g.hits += 1;
    }

    const scoreGroupResults = [...scoreGroups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([score, { hits, total }]) => ({
        score,
        sampleSize: total,
        placeRate: total > 0 ? hits / total : null,
        pValueVsBaseline:
          baselineRate !== null
            ? proportionZTest(hits, total, baselineRate)
            : null,
      }));

    // STとの相関: 連続値同士のPearson相関
    const stRows = rows.filter((r) => r.startTiming !== null);
    const stCorrelation =
      stRows.length > 2
        ? pearsonCorrelation(
            stRows.map((r) => r.score),
            stRows.map((r) => r.startTiming),
          )
        : null;
    const stPValue =
      stCorrelation !== null
        ? pearsonPValue(stCorrelation, stRows.length)
        : null;

    report.systems[system.id] = {
      name: system.name,
      placeHitValidation: {
        baselinePlaceRate: baselineRate,
        baselineSampleSize: placeRows.length,
        scoreGroups: scoreGroupResults,
      },
      startTimingValidation: {
        sampleSize: stRows.length,
        correlation: stCorrelation,
        pValue: stPValue,
      },
    };
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(
    REPORT_DIR,
    `correlation-report-${report.executedAt.slice(0, 10)}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("=== 完了 ===");
  console.log(`レポート保存: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
