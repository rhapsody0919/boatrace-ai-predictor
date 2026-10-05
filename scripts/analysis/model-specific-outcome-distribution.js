/**
 * モデル別 出目分布の生成・比較
 *
 * 目的:
 *   現在の outcome_distribution は「会場別の全レース3連単出目分布」だが、
 *   モデルが実際に推したレース集合は偏っている（例: upsetFocus は実は
 *   1号艇本命レースばかり推している）。
 *   そこでモデルごとに「AI が top_pick として推した艇が実際に1着になった
 *   レース限定」の出目分布を作り、会場全体の分布と比較する。
 *
 * input : predictions（model_id でフィルタ）, race_results
 * output: data/analysis/outcome-distribution-validation/by-model/model-{id}.json
 *
 * 使い方:
 *   node scripts/analysis/model-specific-outcome-distribution.js [--period 30] [--top-n 10]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    period: 30,
    topN: 10,
    outputDir: path.join(
      __dirname,
      "../../data/analysis/outcome-distribution-validation/by-model",
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
    } else if (a === "--output-dir") {
      args.outputDir = next;
      i++;
    }
  }
  return args;
}

function getDateNDaysAgoJST(days) {
  const now = new Date();
  const d = new Date(
    now.getTime() - days * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  return d.toISOString().split("T")[0];
}

function round(v, digits = 2) {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function pct(v) {
  return (v * 100).toFixed(1) + "%";
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
        .gte("race_id", fromDate).order("race_id"),
  );
  const map = new Map();
  for (const r of data) map.set(r.race_id, r);
  return map;
}

async function fetchPredictions(periodDays) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  return fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd",
    (q) =>
      q
        .eq("is_shadow", false)
        .not("is_hit_win", "is", null)
        .gte("race_id", fromDate).order("race_id").order("model_id").order("prediction_id"),
  );
}

// 出目パターン集計（3連単 + 1着艇別）
function buildDistribution(races) {
  const patterns = new Map(); // "r1-r2-r3" -> {count, payoutSum}
  const firstBoatCount = {}; // 1着艇 -> count
  let total = 0;

  for (const r of races) {
    const key = `${r.rank1}-${r.rank2}-${r.rank3}`;
    if (!patterns.has(key)) patterns.set(key, { count: 0, payoutSum: 0 });
    const p = patterns.get(key);
    p.count++;
    p.payoutSum += r.payout_trio || 0;
    firstBoatCount[r.rank1] = (firstBoatCount[r.rank1] || 0) + 1;
    total++;
  }

  const sorted = Array.from(patterns.entries())
    .map(([pattern, v]) => ({
      pattern,
      count: v.count,
      probability: round(total > 0 ? (v.count / total) * 100 : 0),
      avg_payout: v.count > 0 ? Math.round(v.payoutSum / v.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const firstBoatDist = {};
  for (let boat = 1; boat <= 6; boat++) {
    firstBoatDist[boat] = {
      count: firstBoatCount[boat] || 0,
      rate: round(total > 0 ? ((firstBoatCount[boat] || 0) / total) * 100 : 0),
    };
  }

  return { total, patterns: sorted, firstBoatDist };
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("=== モデル別 出目分布の生成・比較 ===");
  console.log(`実行: ${new Date().toISOString()}`);
  console.log(`設定: period=${args.period}日, top-n=${args.topN}`);
  console.log("");

  if (!supabase) {
    console.error("❌ Supabase 未設定（SUPABASE_SERVICE_KEY が必要）");
    process.exit(1);
  }

  console.log("→ データ取得中...");
  const resultMap = await fetchRaceResults(args.period);
  const predictions = await fetchPredictions(args.period);
  console.log(`  race_results: ${resultMap.size}件`);
  console.log(`  predictions: ${predictions.length}件`);
  console.log("");

  // 全レースのベースライン分布（予測が存在するレースのみで母集団を揃える）
  const racesWithPred = new Set(predictions.map((p) => p.race_id));
  const baselineRaces = Array.from(resultMap.values()).filter((r) =>
    racesWithPred.has(r.race_id),
  );
  const baseline = buildDistribution(baselineRaces);

  console.log("【ベースライン（全レース）】");
  console.log(`  対象レース: ${baseline.total}件`);
  console.log(
    `  1着艇分布: ` +
      [1, 2, 3, 4, 5, 6]
        .map((b) => `${b}号=${pct(baseline.firstBoatDist[b].rate / 100)}`)
        .join(" "),
  );
  console.log("");

  if (!fs.existsSync(args.outputDir))
    fs.mkdirSync(args.outputDir, { recursive: true });

  const modelIds = Array.from(new Set(predictions.map((p) => p.model_id)));
  const comparison = [];

  for (const modelId of modelIds) {
    const modelPreds = predictions.filter((p) => p.model_id === modelId);

    // (A) モデルが推した全レース
    const predictedRaces = [];
    // (B) モデルの top_pick が実際に1着になったレース限定
    const topPickWonRaces = [];

    for (const pred of modelPreds) {
      if (pred.top_pick == null) continue;
      const race = resultMap.get(pred.race_id);
      if (!race) continue;
      predictedRaces.push(race);
      if (race.rank1 === pred.top_pick) topPickWonRaces.push(race);
    }

    const distAll = buildDistribution(predictedRaces);
    const distTopPickWon = buildDistribution(topPickWonRaces);

    const topPickWinRate =
      predictedRaces.length > 0
        ? topPickWonRaces.length / predictedRaces.length
        : 0;

    const modelResult = {
      model_id: modelId,
      period_days: args.period,
      predicted_races: predictedRaces.length,
      top_pick_won_races: topPickWonRaces.length,
      top_pick_win_rate: round(topPickWinRate, 4),
      // モデルが推した全レースの出目分布
      distribution_all_predicted: {
        total: distAll.total,
        first_boat_dist: distAll.firstBoatDist,
        top_patterns: distAll.patterns.slice(0, args.topN),
      },
      // top_pick が1着になったレース限定の出目分布
      distribution_top_pick_won: {
        total: distTopPickWon.total,
        first_boat_dist: distTopPickWon.firstBoatDist,
        top_patterns: distTopPickWon.patterns.slice(0, args.topN),
      },
      // ベースラインとの1着艇分布の差分
      first_boat_lift_vs_baseline: {},
    };

    for (let boat = 1; boat <= 6; boat++) {
      modelResult.first_boat_lift_vs_baseline[boat] = round(
        distAll.firstBoatDist[boat].rate - baseline.firstBoatDist[boat].rate,
        2,
      );
    }

    const p = path.join(args.outputDir, `model-${modelId}.json`);
    fs.writeFileSync(p, JSON.stringify(modelResult, null, 2));

    comparison.push(modelResult);

    console.log(`【${modelId}】`);
    console.log(`  推したレース: ${predictedRaces.length}件`);
    console.log(
      `  top_pick が1着: ${topPickWonRaces.length}件 (${pct(topPickWinRate)})`,
    );
    console.log(
      `  推したレースの1着艇分布: ` +
        [1, 2, 3, 4, 5, 6]
          .map((b) => {
            const lift = modelResult.first_boat_lift_vs_baseline[b];
            const sign = lift >= 0 ? "+" : "";
            return `${b}号=${pct(distAll.firstBoatDist[b].rate / 100)}(${sign}${lift})`;
          })
          .join(" "),
    );
    console.log(`  top_pick勝利レース 出目top3:`);
    for (const pat of distTopPickWon.patterns.slice(0, 3)) {
      console.log(
        `    ${pat.pattern}: ${pat.count}回 (${pat.probability}%, 平均配当${pat.avg_payout}円)`,
      );
    }
    console.log(`  → 保存: ${p}`);
    console.log("");
  }

  // 比較サマリ
  const summaryPath = path.join(args.outputDir, "comparison-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        config: { period_days: args.period, top_n: args.topN },
        baseline: {
          total: baseline.total,
          first_boat_dist: baseline.firstBoatDist,
          top_patterns: baseline.patterns.slice(0, args.topN),
        },
        models: comparison.map((m) => ({
          model_id: m.model_id,
          predicted_races: m.predicted_races,
          top_pick_win_rate: m.top_pick_win_rate,
          first_boat_lift_vs_baseline: m.first_boat_lift_vs_baseline,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`✅ 比較サマリ: ${summaryPath}`);
  console.log("\n=== 完了 ===");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(err.stack);
  process.exit(1);
});
