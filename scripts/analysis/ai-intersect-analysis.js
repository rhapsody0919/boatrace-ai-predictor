/**
 * AI予測 ∩ 出目分布TopN カバレッジ詳細分析
 *
 * 目的:
 *   モデル別に「AI が推した3連単（top_pick-top_2nd-top_3rd）が
 *   会場の出目分布 TopN に含まれるか」を詳細分析する。
 *   validate-outcome-distribution.js が出した
 *   「upsetFocus + 分布 = 100.4% 回収」の内訳を解明することが主目的。
 *
 * 買い方の定義（このスクリプトが評価するベッティング戦略）:
 *   各レース・各モデルについて、AI が推す3連単 1点 を 100円 で買う。
 *   ただし「その3連単パターンが当該会場の出目分布 TopN に含まれるレースのみ」購入。
 *   的中時の払戻は predictions.payout_trio（DB トリガーが格納した実配当）。
 *
 * 使い方:
 *   node scripts/analysis/ai-intersect-analysis.js [--period 30] [--top-n 5] [--format json,csv]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    period: 30,
    topN: 5,
    format: "json",
    outputDir: path.join(
      __dirname,
      "../../data/analysis/outcome-distribution-validation",
    ),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--period") {
      args.period = parseInt(next, 10);
      i++;
    } else if (a === "--top-n") {
      args.topN = parseInt(next, 10);
      i++;
    } else if (a === "--format") {
      args.format = next;
      i++;
    } else if (a === "--output-dir") {
      args.outputDir = next;
      i++;
    }
  }
  args.formats = args.format
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (args.formats.includes("all")) args.formats = ["json", "csv"];
  return args;
}

function getDateNDaysAgoJST(days) {
  const now = new Date();
  const d = new Date(
    now.getTime() - days * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  return d.toISOString().split("T")[0];
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function pct(v) {
  return (v * 100).toFixed(1) + "%";
}

// 中央値
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

async function fetchOutcomeDistribution() {
  const data = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, total_races, probability, avg_payout",
    (q) =>
      q
        .order("venue_code", { ascending: true })
        .order("probability", { ascending: false }),
  );
  const byVenue = new Map();
  for (const row of data) {
    if (!byVenue.has(row.venue_code)) byVenue.set(row.venue_code, []);
    byVenue.get(row.venue_code).push(row);
  }
  for (const [, arr] of byVenue)
    arr.sort((a, b) => b.probability - a.probability);
  return byVenue;
}

async function fetchRaceResults(periodDays) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  const data = await fetchAll(
    "race_results",
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    "race_id, rank1, rank2, rank3, payout_trio",
    (q) =>
      q
        .eq("is_cancelled", false)
        .eq("is_no_race", false)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .gte("race_id", fromDate),
  );
  const map = new Map();
  for (const r of data) {
    const parts = r.race_id.split("-");
    if (parts.length < 4) continue;
    const venueCode = parseInt(parts[3], 10);
    if (!venueCode || isNaN(venueCode)) continue;
    map.set(r.race_id, { ...r, venue_code: venueCode });
  }
  return map;
}

async function fetchPredictions(periodDays) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  return fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd, is_hit_trio, payout_trio",
    (q) =>
      q
        .eq("is_shadow", false)
        .not("is_hit_win", "is", null)
        .gte("race_id", fromDate),
  );
}

function analyzeModel({ modelId, predictions, resultMap, distMap, topN }) {
  const modelPreds = predictions.filter((p) => p.model_id === modelId);

  let totalPredictions = 0; // 結果が存在し AI予測が揃っているレース
  let aiHitsAll = 0; // AI単独の的中数（全レース）
  let aiPayoutAll = 0; // AI単独の払戻合計（全レース）

  const inDistRows = []; // AI予測が分布TopN内のレース
  const patternStats = new Map(); // 分布TopN内に入った AI予測パターンごとの統計

  for (const pred of modelPreds) {
    if (pred.top_pick == null || pred.top_2nd == null || pred.top_3rd == null)
      continue;
    const race = resultMap.get(pred.race_id);
    if (!race) continue;

    totalPredictions++;
    const aiPattern = `${pred.top_pick}-${pred.top_2nd}-${pred.top_3rd}`;
    const actualPattern = `${race.rank1}-${race.rank2}-${race.rank3}`;
    const aiHit = aiPattern === actualPattern;
    const aiPayout = pred.payout_trio || 0;

    if (aiHit) aiHitsAll++;
    aiPayoutAll += aiPayout;

    // 分布TopN内か
    const venueDist = distMap.get(race.venue_code) ?? [];
    const topNPatterns = venueDist.slice(0, topN);
    const distEntry = topNPatterns.find(
      (d) => `${d.first_boat}-${d.second_boat}-${d.third_boat}` === aiPattern,
    );

    if (distEntry) {
      inDistRows.push({
        race_id: pred.race_id,
        venue_code: race.venue_code,
        aiPattern,
        aiHit,
        aiPayout,
        distEntry,
      });

      const key = aiPattern;
      if (!patternStats.has(key)) {
        patternStats.set(key, {
          pattern: key,
          appearances: 0, // この AI予測パターンが分布TopN内で出た回数
          hits: 0,
          payout_sum: 0,
          probability_samples: [],
          avg_payout_samples: [],
        });
      }
      const ps = patternStats.get(key);
      ps.appearances++;
      if (aiHit) ps.hits++;
      ps.payout_sum += aiPayout;
      ps.probability_samples.push(distEntry.probability);
      if (distEntry.avg_payout != null)
        ps.avg_payout_samples.push(distEntry.avg_payout);
    }
  }

  const coveredByDistribution = inDistRows.length;
  const inDistHits = inDistRows.filter((r) => r.aiHit).length;
  const inDistPayout = inDistRows.reduce((s, r) => s + r.aiPayout, 0);
  const inDistInvestment = coveredByDistribution * 100;

  const aiRecoveryAll =
    totalPredictions > 0 ? aiPayoutAll / (totalPredictions * 100) : 0;
  const intersectRecovery =
    inDistInvestment > 0 ? inDistPayout / inDistInvestment : 0;

  // 的中レースの配当（極端値検出用）
  const hitPayouts = inDistRows.filter((r) => r.aiHit).map((r) => r.aiPayout);
  const maxHitPayout = hitPayouts.length > 0 ? Math.max(...hitPayouts) : 0;
  const medianHitPayout = median(hitPayouts);
  // 最大配当1件を除いた回収率（極端値依存度の確認）
  const recoveryExclMax =
    inDistInvestment > 0 ? (inDistPayout - maxHitPayout) / inDistInvestment : 0;

  // パターン別 top10（appearances 降順）
  const specificPatterns = Array.from(patternStats.values())
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 10)
    .map((ps) => ({
      pattern: ps.pattern,
      appearances: ps.appearances,
      hits: ps.hits,
      hit_rate: round(ps.appearances > 0 ? ps.hits / ps.appearances : 0),
      payout_sum: ps.payout_sum,
      recovery_rate: round(
        ps.appearances > 0 ? ps.payout_sum / (ps.appearances * 100) : 0,
      ),
      dist_probability_avg: round(
        ps.probability_samples.length > 0
          ? ps.probability_samples.reduce((a, b) => a + b, 0) /
              ps.probability_samples.length
          : 0,
        2,
      ),
      dist_avg_payout:
        ps.avg_payout_samples.length > 0
          ? Math.round(
              ps.avg_payout_samples.reduce((a, b) => a + b, 0) /
                ps.avg_payout_samples.length,
            )
          : null,
    }));

  return {
    model_id: modelId,
    total_predictions: totalPredictions,
    covered_by_distribution: coveredByDistribution,
    coverage_rate: round(
      totalPredictions > 0 ? coveredByDistribution / totalPredictions : 0,
    ),
    ai_hits_all: aiHitsAll,
    ai_hit_rate: round(totalPredictions > 0 ? aiHitsAll / totalPredictions : 0),
    ai_recovery_all: round(aiRecoveryAll),
    intersect_hits: inDistHits,
    intersect_hit_rate: round(
      coveredByDistribution > 0 ? inDistHits / coveredByDistribution : 0,
    ),
    intersect_recovery_rate: round(intersectRecovery),
    lift_vs_ai_only: round(intersectRecovery - aiRecoveryAll),
    // 極端値依存度の診断
    hit_payout_max: maxHitPayout,
    hit_payout_median: medianHitPayout,
    intersect_recovery_excl_max: round(recoveryExclMax),
    extreme_value_dependency: round(intersectRecovery - recoveryExclMax),
    specific_patterns: specificPatterns,
  };
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== AI予測 ∩ 出目分布TopN カバレッジ詳細分析 ===");
  console.log(`実行: ${new Date().toISOString()}`);
  console.log(`設定: period=${args.period}日, top-n=${args.topN}`);
  console.log("");
  console.log(
    "買い方の定義: AI予測3連単を1点100円で買う。ただし分布TopN内のレースのみ購入。",
  );
  console.log(
    "⚠️ outcome_distribution は現スナップショットのみ → 現分布を全期間に適用する近似。",
  );
  console.log("");

  if (!supabase) {
    console.error("❌ Supabase 未設定（SUPABASE_SERVICE_KEY が必要）");
    process.exit(1);
  }

  console.log("→ データ取得中...");
  const distMap = await fetchOutcomeDistribution();
  const resultMap = await fetchRaceResults(args.period);
  const predictions = await fetchPredictions(args.period);
  console.log(`  outcome_distribution: ${distMap.size}会場`);
  console.log(`  race_results: ${resultMap.size}件`);
  console.log(`  predictions: ${predictions.length}件`);
  console.log("");

  const modelIds = Array.from(new Set(predictions.map((p) => p.model_id)));
  const results = [];
  for (const modelId of modelIds) {
    const r = analyzeModel({
      modelId,
      predictions,
      resultMap,
      distMap,
      topN: args.topN,
    });
    results.push(r);
  }
  results.sort((a, b) => b.lift_vs_ai_only - a.lift_vs_ai_only);

  // コンソール出力
  for (const r of results) {
    console.log(`【${r.model_id}】`);
    console.log(`  total_predictions     : ${r.total_predictions}`);
    console.log(
      `  covered_by_distribution: ${r.covered_by_distribution} (${pct(r.coverage_rate)})`,
    );
    console.log(
      `  ai_hit_rate (全体)     : ${pct(r.ai_hit_rate)} (${r.ai_hits_all}/${r.total_predictions})`,
    );
    console.log(`  ai_recovery (全体)     : ${pct(r.ai_recovery_all)}`);
    console.log(
      `  intersect_hit_rate     : ${pct(r.intersect_hit_rate)} (${r.intersect_hits}/${r.covered_by_distribution})`,
    );
    console.log(`  intersect_recovery     : ${pct(r.intersect_recovery_rate)}`);
    console.log(
      `  lift_vs_ai_only        : ${(r.lift_vs_ai_only * 100).toFixed(1)}pt`,
    );
    console.log(`  --- 極端値診断 ---`);
    console.log(
      `  的中時配当 最大/中央値 : ${r.hit_payout_max} / ${r.hit_payout_median}`,
    );
    console.log(
      `  最大配当1件を除く回収率: ${pct(r.intersect_recovery_excl_max)} (依存度 ${(r.extreme_value_dependency * 100).toFixed(1)}pt)`,
    );
    console.log(`  --- 分布TopN内 AI予測パターン top5 ---`);
    for (const p of r.specific_patterns.slice(0, 5)) {
      console.log(
        `    ${p.pattern}: ${p.appearances}回中${p.hits}的中 (回収${pct(p.recovery_rate)}, 分布確率${p.dist_probability_avg}%)`,
      );
    }
    console.log("");
  }

  // 出力
  if (!fs.existsSync(args.outputDir))
    fs.mkdirSync(args.outputDir, { recursive: true });

  const summary = {
    generated_at: new Date().toISOString(),
    config: {
      period_days: args.period,
      top_n: args.topN,
      from_date: getDateNDaysAgoJST(args.period),
    },
    approximation_note:
      "outcome_distribution は現スナップショットのみ。本評価は現分布を全期間に適用する近似値。",
    betting_strategy:
      "AI予測の3連単(top_pick-top_2nd-top_3rd)を1点100円で買う。分布TopN内のレースのみ購入。的中払戻は predictions.payout_trio。",
    models: results,
  };

  if (args.formats.includes("json")) {
    const p = path.join(args.outputDir, "ai-intersect-analysis.json");
    fs.writeFileSync(p, JSON.stringify(summary, null, 2));
    console.log(`✅ JSON: ${p}`);
  }
  if (args.formats.includes("csv")) {
    const p = path.join(args.outputDir, "ai-intersect-analysis.csv");
    const cols = [
      "model_id",
      "total_predictions",
      "covered_by_distribution",
      "coverage_rate",
      "ai_hit_rate",
      "ai_recovery_all",
      "intersect_hit_rate",
      "intersect_recovery_rate",
      "lift_vs_ai_only",
      "hit_payout_max",
      "hit_payout_median",
      "intersect_recovery_excl_max",
      "extreme_value_dependency",
    ];
    const lines = [cols.join(",")];
    for (const r of results) lines.push(cols.map((c) => r[c]).join(","));
    fs.writeFileSync(p, lines.join("\n"));
    console.log(`✅ CSV: ${p}`);
  }

  console.log("\n=== 完了 ===");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(err.stack);
  process.exit(1);
});
