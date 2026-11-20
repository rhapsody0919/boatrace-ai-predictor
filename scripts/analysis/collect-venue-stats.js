/**
 * 24会場の詳細統計分析スクリプト
 *
 * 天才データサイエンティスト視点での統計指標：
 * - 基本統計（的中率、回収率）
 * - 信頼区間（95%CI）
 * - シャープレシオ（リスク調整後リターン）
 * - 最大ドローダウン
 * - 連勝/連敗記録
 * - 条件別分析（級別、モーター性能別）
 * - 統計的有意性検定
 * - 期待値分析
 */

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  createVenueStats,
  createAccumulator,
  collectPrediction,
} from "./collectVenueStatsAccumulate.js";
import {
  fillBasicAndBetStats,
  fillRiskAndStreaks,
  fillConditionStats,
  fillCombinationStats,
  extractProfitableRules,
  fillRecommendation,
} from "./collectVenueStatsFill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 予測・結果・選手情報を取得（エラー時は null）
 */
async function fetchVenueData(venueCode, venueCodeStr) {
  // 1. 予測データ取得（全モデル）
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCodeStr}-%`);

  if (error) {
    console.error(
      `Error fetching predictions for venue ${venueCode}:`,
      error.message,
    );
    return null;
  }

  // 2. 結果データ取得
  const raceIds = [...new Set(predictions.map((p) => p.race_id))];

  const { data: results, error: resultsError } = await supabase
    .from("race_results")
    .select("*")
    .in("race_id", raceIds);

  if (resultsError) {
    console.error(
      `Error fetching results for venue ${venueCode}:`,
      resultsError.message,
    );
    return null;
  }

  // 3. race_entries（選手情報）取得
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, grade, win_rate, motor_2rate")
    .in("race_id", raceIds);

  if (entriesError) {
    console.error(
      `Error fetching entries for venue ${venueCode}:`,
      entriesError.message,
    );
    return null;
  }

  return { predictions, results, entries };
}

function buildResultsMap(results) {
  const resultsMap = {};
  results?.forEach((r) => {
    resultsMap[r.race_id] = r;
  });
  return resultsMap;
}

function buildEntriesMap(entries) {
  const entriesMap = {};
  entries?.forEach((e) => {
    if (!entriesMap[e.race_id]) entriesMap[e.race_id] = {};
    entriesMap[e.race_id][e.boat_number] = e;
  });
  return entriesMap;
}

async function collectVenueStats(venueCode) {
  const venueName = VENUE_NAMES[venueCode];
  const venueCodeStr = String(venueCode).padStart(2, "0");

  const fetched = await fetchVenueData(venueCode, venueCodeStr);
  if (!fetched) return null;
  const { predictions, results, entries } = fetched;

  // マップ化
  const resultsMap = buildResultsMap(results);
  const entriesMap = buildEntriesMap(entries);

  // standardモデルのみで分析
  const standardPreds = predictions.filter((p) => p.model_id === "standard");

  // ===== 統計計算 =====

  const stats = createVenueStats(venueCode, venueName);

  // データ収集
  const acc = createAccumulator();
  for (const pred of standardPreds) {
    collectPrediction(acc, pred, resultsMap, entriesMap);
  }
  stats.sample_size = acc.sampleSize;

  if (stats.sample_size === 0) return null;

  // 日付範囲
  const dates = acc.dates;
  dates.sort();
  stats.data_period.start = dates[0];
  stats.data_period.end = dates[dates.length - 1];

  // ===== 統計値計算 =====
  fillBasicAndBetStats(stats, acc);
  fillRiskAndStreaks(stats, acc);
  fillConditionStats(stats, acc);
  fillCombinationStats(stats, acc);
  stats.profitable_rules = extractProfitableRules(stats.combinations);
  fillRecommendation(stats);

  return stats;
}

// ===== メイン処理 =====

function printVenueStats(stats) {
  console.log(`\n【${stats.venue_name}】 (${stats.sample_size}レース)`);
  console.log(`  期間: ${stats.data_period.start} 〜 ${stats.data_period.end}`);
  console.log(`  1号艇勝率: ${stats.basic.first_boat_win_rate}%`);
  console.log(`  ─────────────────────────────────────`);
  console.log(
    `  単勝: 的中率 ${stats.bet_types.win.hit_rate}% [CI: ${stats.bet_types.win.hit_rate_ci95.lower}-${stats.bet_types.win.hit_rate_ci95.upper}%], 回収率 ${stats.bet_types.win.recovery_rate}%`,
  );
  console.log(
    `  複勝: 的中率 ${stats.bet_types.place.hit_rate}%, 回収率 ${stats.bet_types.place.recovery_rate}%`,
  );
  console.log(
    `  3連複: 的中率 ${stats.bet_types.trio.hit_rate}%, 回収率 ${stats.bet_types.trio.recovery_rate}%`,
  );
  console.log(
    `  3連単: 的中率 ${stats.bet_types.trifecta.hit_rate}%, 回収率 ${stats.bet_types.trifecta.recovery_rate}%`,
  );
  console.log(`  ─────────────────────────────────────`);
  console.log(`  シャープレシオ: ${stats.risk.sharpe_ratio}`);
  console.log(`  最大DD: ${stats.risk.max_drawdown}円`);
  console.log(
    `  連勝/連敗: ${stats.streaks.win.max_win}連勝 / ${stats.streaks.win.max_lose}連敗`,
  );
  console.log(`  ─────────────────────────────────────`);
  console.log(
    `  推奨度: ${stats.recommendation.grade} (${stats.recommendation.score}点)`,
  );
  if (stats.recommendation.reasons.length > 0) {
    console.log(`  理由: ${stats.recommendation.reasons.join(", ")}`);
  }

  // 有望条件（回収率100%超え）を表示
  if (stats.profitable_rules.length > 0) {
    console.log(`  ─────────────────────────────────────`);
    console.log(`  🎯 有望条件 (回収率100%↑, n≥10):`);
    for (const rule of stats.profitable_rules.slice(0, 5)) {
      console.log(
        `     ${rule.condition}: ${rule.recovery_rate}% (${rule.total}レース, 的中${rule.hit_rate}%)`,
      );
    }
    if (stats.profitable_rules.length > 5) {
      console.log(`     ...他${stats.profitable_rules.length - 5}件`);
    }
  }
}

async function analyzeAllVenues(venuesToAnalyze) {
  const allStats = [];
  for (const venueCode of venuesToAnalyze) {
    const stats = await collectVenueStats(venueCode);

    if (stats && stats.sample_size > 0) {
      allStats.push(stats);
      printVenueStats(stats);
    } else {
      console.log(`\n【${VENUE_NAMES[venueCode]}】 データなし`);
    }
  }
  return allStats;
}

// ===== ランキング =====
function printRankings(allStats) {
  console.log("\n" + "=".repeat(70));
  console.log("\n📈 ランキング（単勝回収率順）");
  console.log("─".repeat(50));

  const sortedByRecovery = [...allStats]
    .filter((s) => s.sample_size >= 20)
    .sort(
      (a, b) =>
        parseFloat(b.bet_types.win.recovery_rate) -
        parseFloat(a.bet_types.win.recovery_rate),
    );

  sortedByRecovery.forEach((s, i) => {
    const marker =
      parseFloat(s.bet_types.win.recovery_rate) >= 100 ? "🔥" : "  ";
    console.log(
      `${marker} ${(i + 1).toString().padStart(2)}. ${s.venue_name.padEnd(6)} ${s.bet_types.win.recovery_rate.padStart(6)}% (${s.sample_size}レース) [${s.recommendation.grade}]`,
    );
  });

  console.log("\n📊 推奨度ランキング");
  console.log("─".repeat(50));

  const sortedByScore = [...allStats]
    .filter((s) => s.sample_size >= 20)
    .sort((a, b) => b.recommendation.score - a.recommendation.score);

  sortedByScore.slice(0, 10).forEach((s, i) => {
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${s.venue_name.padEnd(6)} ${s.recommendation.score.toString().padStart(3)}点 [${s.recommendation.grade}] - ${s.recommendation.reasons[0] || ""}`,
    );
  });

  return { sortedByRecovery, sortedByScore };
}

// ===== 全会場の有望条件（組み合わせ分析） =====
function printAllProfitableRules(allStats) {
  console.log("\n🎯 全会場の有望条件（回収率100%↑, n≥10）");
  console.log("─".repeat(70));

  // 全会場の有望条件を集約
  const allProfitableRules = [];
  for (const s of allStats) {
    for (const rule of s.profitable_rules) {
      allProfitableRules.push({
        venue: s.venue_name,
        venue_code: s.venue_code,
        ...rule,
      });
    }
  }

  // 回収率順にソート
  allProfitableRules.sort(
    (a, b) => parseFloat(b.recovery_rate) - parseFloat(a.recovery_rate),
  );

  // 上位20件を表示
  console.log("\n  【回収率TOP20】");
  for (const rule of allProfitableRules.slice(0, 20)) {
    const marker = parseFloat(rule.recovery_rate) >= 120 ? "🔥" : "  ";
    console.log(
      `${marker} ${rule.venue.padEnd(4)} | ${rule.condition.padEnd(25)} | ${rule.recovery_rate.padStart(6)}% | ${rule.total}R | 的中${rule.hit_rate}%`,
    );
  }

  // 会場別サマリー
  console.log("\n  【会場別 有望条件数】");
  const venueRuleCounts = {};
  for (const rule of allProfitableRules) {
    venueRuleCounts[rule.venue] = (venueRuleCounts[rule.venue] || 0) + 1;
  }
  const sortedVenues = Object.entries(venueRuleCounts).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [venue, count] of sortedVenues.slice(0, 10)) {
    console.log(`     ${venue}: ${count}件`);
  }

  return { allProfitableRules, sortedVenues };
}

// ===== 結果を保存 =====
async function saveOutput(allStats, rankings, profitable) {
  const { sortedByRecovery, sortedByScore } = rankings;
  const { allProfitableRules, sortedVenues } = profitable;
  const outputPath = path.join(
    __dirname,
    "../../data/analysis/summary/venue-stats.json",
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    total_venues: allStats.length,
    total_races: allStats.reduce((a, s) => a + s.sample_size, 0),
    venues: allStats,
    rankings: {
      by_recovery: sortedByRecovery.map((s) => ({
        code: s.venue_code,
        name: s.venue_name,
        recovery: s.bet_types.win.recovery_rate,
      })),
      by_recommendation: sortedByScore.map((s) => ({
        code: s.venue_code,
        name: s.venue_name,
        score: s.recommendation.score,
        grade: s.recommendation.grade,
      })),
    },
    // 全会場の有望条件（回収率100%↑）
    profitable_rules: allProfitableRules,
    profitable_rules_summary: {
      total_count: allProfitableRules.length,
      by_venue: sortedVenues.map(([venue, count]) => ({ venue, count })),
      top_10: allProfitableRules.slice(0, 10),
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ 結果を保存しました: ${outputPath}`);
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("📊 24会場の詳細統計分析を実行中...\n");
  console.log("=".repeat(70));

  const venueArg = process.argv.find((arg) => arg.startsWith("--venue="));
  const targetVenue = venueArg ? parseInt(venueArg.split("=")[1]) : null;

  const venuesToAnalyze = targetVenue
    ? [targetVenue]
    : Array.from({ length: 24 }, (_, i) => i + 1);

  const allStats = await analyzeAllVenues(venuesToAnalyze);

  // ===== ランキング =====
  const rankings = printRankings(allStats);

  // ===== 全会場の有望条件（組み合わせ分析） =====
  const profitable = printAllProfitableRules(allStats);

  // ===== 結果を保存 =====
  await saveOutput(allStats, rankings, profitable);
}

main().catch(console.error);
