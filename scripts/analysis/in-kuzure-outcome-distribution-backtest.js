/**
 * イン崩れレース × 出目分布 バックテスト
 *
 * 仮説:
 *   イン崩れ確率が高いレースで、AI が予測した舟番（1号艇以外）が
 *   実際に1着になった場合、その舟番の出目分布Top10を購入すると的中しやすい。
 *
 * 対象レース:
 *   legacy モード（デフォルト, 3条件すべて満たす）:
 *     1. volatility_level = 'high' かつ volatility_score >= 60
 *     2. predictions.top_pick != 1（1号艇以外が本命）
 *     3. race_results.rank1 = predictions.top_pick（実際にその舟が1着）
 *     ※ 条件3はレース結果を見て絞るためルックアヘッドバイアスあり（回収率を過大評価）。
 *
 *   --correct-bias モード（2条件のみ, バイアス除外）:
 *     1. volatility_level = 'high' かつ volatility_score >= 60
 *     2. predictions.top_pick != 1
 *     ※ 条件3を外し、レース前に確定する情報だけで母集団を決定。
 *        top_pick が外れたレースも母集団に含め、recovery_rate を正しく測る。
 *
 * 買い目戦略:
 *   各対象レースで、outcome_distribution から「first_boat = top_pick」の
 *   出目パターンを probability 降順 Top10 取得し、3連単10点 × 100円購入。
 *   的中: top_pick が実際に1着 かつ (rank2,rank3) が出目Top10 に含まれるレース。
 *   的中時の払戻は race_results.payout_trio。
 *
 * 注意:
 *   - 仕様の in_kuzure_probability カラムは DB に存在しないため、
 *     races.volatility_score（0-100）を代理指標とし、>= 60 を「確率0.60以上」と解釈。
 *   - outcome_distribution は現スナップショットのみ保持 → 現分布を全期間に適用する近似。
 *
 * 使い方:
 *   node scripts/analysis/in-kuzure-outcome-distribution-backtest.js [--period 90] [--format json,csv] [--correct-bias]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VOLATILITY_SCORE_THRESHOLD = 60; // in_kuzure_probability >= 0.60 の代理
const TOP_N_PATTERNS = 10;

function parseArgs(argv) {
  const args = {
    period: 90,
    format: "json",
    correctBias: false,
    outputDir: path.join(
      __dirname,
      "../../data/analysis/in-kuzure-outcome-distribution-backtest",
    ),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--period") {
      args.period = parseInt(next, 10);
      i++;
    } else if (a === "--format") {
      args.format = next;
      i++;
    } else if (a === "--output-dir") {
      args.outputDir = next;
      i++;
    } else if (a === "--correct-bias") {
      args.correctBias = true;
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

// 出目分布を venue_code × first_boat でインデックス化（probability 降順）
async function fetchOutcomeDistribution() {
  const data = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, total_races, probability, avg_payout",
    (q) => q.order("probability", { ascending: false }),
  );
  const byVenueFirst = new Map(); // key: `${venue}-${first}` -> [patterns]
  for (const row of data) {
    const key = `${row.venue_code}-${row.first_boat}`;
    if (!byVenueFirst.has(key)) byVenueFirst.set(key, []);
    byVenueFirst.get(key).push(row);
  }
  for (const [, arr] of byVenueFirst) {
    arr.sort((a, b) => b.probability - a.probability);
  }
  return byVenueFirst;
}

async function fetchHighVolatilityRaces(periodDays) {
  const fromDate = getDateNDaysAgoJST(periodDays);
  return fetchAll(
    "races",
    "race_id, venue_code, race_number, volatility_level, volatility_score",
    (q) =>
      q
        .eq("volatility_level", "high")
        .gte("volatility_score", VOLATILITY_SCORE_THRESHOLD)
        .gte("race_date", fromDate).order("race_id"),
  );
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
    "race_id, model_id, top_pick, top_2nd, top_3rd, payout_trio",
    (q) =>
      q
        .eq("is_shadow", false)
        .not("is_hit_win", "is", null)
        .gte("race_id", fromDate).order("race_id").order("model_id").order("prediction_id"),
  );
}

// 1レース1モデルのバックテスト結果を作る
function evaluateRace({ race, result, pred, distByVenueFirst }) {
  const topPick = pred.top_pick;
  const actualPattern = `${result.rank1}-${result.rank2}-${result.rank3}`;

  // outcome_distribution: first_boat = topPick の Top10
  const distKey = `${race.venue_code}-${topPick}`;
  const top10 = (distByVenueFirst.get(distKey) ?? []).slice(0, TOP_N_PATTERNS);

  // 買い目戦略
  const betPatterns = top10.map(
    (d) => `${d.first_boat}-${d.second_boat}-${d.third_boat}`,
  );
  const distInvestment = betPatterns.length * 100;
  const distHit = betPatterns.includes(actualPattern);
  const distPayout = distHit ? result.payout_trio || 0 : 0;

  // AI 単独（top_pick-top_2nd-top_3rd の3連単1点）
  const aiPattern =
    pred.top_2nd != null && pred.top_3rd != null
      ? `${topPick}-${pred.top_2nd}-${pred.top_3rd}`
      : null;
  const aiHit = aiPattern != null && aiPattern === actualPattern;
  const aiInvestment = 100;
  const aiPayout = aiHit ? pred.payout_trio || result.payout_trio || 0 : 0;

  return {
    race_id: race.race_id,
    venue_code: race.venue_code,
    race_number: race.race_number,
    model_id: pred.model_id,
    volatility_level: race.volatility_level,
    volatility_score: race.volatility_score,
    top_pick: topPick,
    actualPattern,
    aiPattern,
    betPatterns,
    distPatternCount: betPatterns.length,
    distInvestment,
    distHit,
    distPayout,
    aiInvestment,
    aiHit,
    aiPayout,
  };
}

function aggregate(rows) {
  if (rows.length === 0) {
    return {
      total_races: 0,
      hit_count: 0,
      hit_rate: 0,
      recovery_rate: 0,
      ai_hit_count: 0,
      ai_hit_rate: 0,
      ai_recovery_rate: 0,
      lift_vs_ai_only: 0,
    };
  }
  const n = rows.length;
  const hitCount = rows.filter((r) => r.distHit).length;
  const distInvestment = rows.reduce((s, r) => s + r.distInvestment, 0);
  const distPayout = rows.reduce((s, r) => s + r.distPayout, 0);

  const aiHitCount = rows.filter((r) => r.aiHit).length;
  const aiInvestment = rows.reduce((s, r) => s + r.aiInvestment, 0);
  const aiPayout = rows.reduce((s, r) => s + r.aiPayout, 0);

  const recoveryRate = distInvestment > 0 ? distPayout / distInvestment : 0;
  const aiRecoveryRate = aiInvestment > 0 ? aiPayout / aiInvestment : 0;

  return {
    total_races: n,
    hit_count: hitCount,
    hit_rate: round(hitCount / n),
    recovery_rate: round(recoveryRate),
    dist_investment: distInvestment,
    dist_payout: distPayout,
    ai_hit_count: aiHitCount,
    ai_hit_rate: round(aiHitCount / n),
    ai_recovery_rate: round(aiRecoveryRate),
    lift_vs_ai_only: round(recoveryRate - aiRecoveryRate),
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv);

  // --correct-bias 時は出力先を分けて Task #10 の結果を上書きしない
  if (args.correctBias && !process.argv.includes("--output-dir")) {
    args.outputDir = path.join(
      __dirname,
      "../../data/analysis/in-kuzure-outcome-distribution-backtest-correct-bias",
    );
  }

  console.log("=== イン崩れレース × 出目分布 バックテスト ===");
  console.log(`実行: ${new Date().toISOString()}`);
  console.log(
    `設定: period=${args.period}日, mode=${args.correctBias ? "correct-bias（バイアス除外）" : "legacy（条件3あり）"}`,
  );
  console.log("");
  console.log("⚠️ 注意事項:");
  console.log(`  - in_kuzure_probability カラムは DB に存在しないため、`);
  console.log(
    `    races.volatility_score >= ${VOLATILITY_SCORE_THRESHOLD} を「確率0.60以上」の代理指標として使用。`,
  );
  console.log(
    "  - outcome_distribution は現スナップショットのみ → 現分布を全期間に適用する近似。",
  );
  console.log("");
  if (args.correctBias) {
    console.log(
      "対象レース2条件: volatility_level=high & score>=60 / top_pick!=1",
    );
    console.log(
      "  ※ ルックアヘッドバイアス除外のため条件3（rank1=top_pick）は適用しない。",
    );
    console.log(
      "  ※ 母集団＝高荒れ&非1号艇本命の全レース。レース前に分かる情報のみで対象を確定。",
    );
  } else {
    console.log(
      "対象レース3条件: volatility_level=high & score>=60 / top_pick!=1 / rank1=top_pick",
    );
  }
  console.log(
    "買い目: outcome_distribution の first_boat=top_pick パターン Top10 を3連単10点×100円。",
  );
  console.log(
    "的中: top_pick が実際に1着 かつ (rank2,rank3) が出目Top10 に含まれるレース。",
  );
  console.log("");

  if (!supabase) {
    console.error("❌ Supabase 未設定（SUPABASE_SERVICE_KEY が必要）");
    process.exit(1);
  }

  // ===== データ取得 =====
  console.log("→ データ取得中...");
  const distByVenueFirst = await fetchOutcomeDistribution();
  const highRaces = await fetchHighVolatilityRaces(args.period);
  const resultMap = await fetchRaceResults(args.period);
  const predictions = await fetchPredictions(args.period);
  console.log(
    `  outcome_distribution: ${distByVenueFirst.size} 個の(venue,first)キー`,
  );
  console.log(`  high volatility races: ${highRaces.length}件`);
  console.log(`  race_results: ${resultMap.size}件`);
  console.log(`  predictions: ${predictions.length}件`);
  console.log("");

  // predictions を race_id × model_id でインデックス化
  const predIndex = new Map();
  for (const p of predictions) {
    predIndex.set(`${p.race_id}::${p.model_id}`, p);
  }
  const modelIds = Array.from(new Set(predictions.map((p) => p.model_id)));

  // ===== 対象レース抽出 + バックテスト =====
  console.log("→ 対象レース抽出・バックテスト中...");
  const highRaceMap = new Map(highRaces.map((r) => [r.race_id, r]));

  // 絞り込みの内訳カウント（診断用）
  let cntHighWithResult = 0;
  let cntTopPickNot1 = 0;
  let cntTopPickWon = 0;

  const matched = [];
  for (const race of highRaces) {
    const result = resultMap.get(race.race_id);
    if (!result) continue;
    cntHighWithResult++;

    for (const modelId of modelIds) {
      const pred = predIndex.get(`${race.race_id}::${modelId}`);
      if (!pred) continue;
      if (pred.top_pick == null) continue;

      // 条件2: top_pick != 1
      if (pred.top_pick === 1) continue;
      cntTopPickNot1++;

      // 条件3: rank1 = top_pick
      // --correct-bias 時はルックアヘッドバイアス除外のためスキップ。
      // （結果を見て対象を絞ると実運用不可能な後知恵戦略になる）
      const topPickWon = result.rank1 === pred.top_pick;
      if (topPickWon) cntTopPickWon++;
      if (!args.correctBias && !topPickWon) continue;

      const row = evaluateRace({ race, result, pred, distByVenueFirst });
      // 出目分布データが無い (venue,first) は除外
      if (row.distPatternCount === 0) continue;
      matched.push(row);
    }
  }

  console.log(`  high & 結果あり: ${cntHighWithResult}レース`);
  console.log(`  + top_pick!=1（モデル×レース）: ${cntTopPickNot1}件`);
  if (args.correctBias) {
    console.log(
      `  （参考）うち rank1=top_pick だったレース: ${cntTopPickWon}件 = ${pct(cntTopPickNot1 > 0 ? cntTopPickWon / cntTopPickNot1 : 0)}`,
    );
    console.log(
      `  → 母集団（条件3を外した対象, 出目分布データあり）: ${matched.length}件`,
    );
  } else {
    console.log(`  + rank1=top_pick（対象）: ${cntTopPickWon}件`);
    console.log(`  + 出目分布データあり（最終）: ${matched.length}件`);
  }
  console.log("");

  if (matched.length === 0) {
    console.log("対象レースが0件のため終了。");
    return;
  }

  // ===== 集計 =====
  const overall = aggregate(matched);

  // 会場別
  const byVenueGroups = groupBy(matched, (r) => r.venue_code);
  const byVenue = [];
  for (const [venueCode, rows] of byVenueGroups) {
    byVenue.push({
      venue_code: venueCode,
      venue_name: VENUE_NAMES[venueCode] || `会場${venueCode}`,
      ...aggregate(rows),
    });
  }
  byVenue.sort((a, b) => b.recovery_rate - a.recovery_rate);

  // 荒れ度別（high のみが対象なので high が全てだが、比較用に score 帯で分割）
  const byVolatilityLevel = [];
  for (const [band, label] of [
    [[60, 70], "high(score 60-69)"],
    [[70, 85], "high(score 70-84)"],
    [[85, 101], "high(score 85+)"],
  ]) {
    const rows = matched.filter(
      (r) => r.volatility_score >= band[0] && r.volatility_score < band[1],
    );
    if (rows.length === 0) continue;
    byVolatilityLevel.push({ band: label, ...aggregate(rows) });
  }

  // モデル別
  const byModelGroups = groupBy(matched, (r) => r.model_id);
  const byModel = [];
  for (const [modelId, rows] of byModelGroups) {
    byModel.push({ model_id: modelId, ...aggregate(rows) });
  }
  byModel.sort((a, b) => b.recovery_rate - a.recovery_rate);

  // 実例: 的中例10件（配当大きい順）+ 不的中例10件
  const caseMapper = (r) => ({
    race_id: r.race_id,
    venue: VENUE_NAMES[r.venue_code] || `会場${r.venue_code}`,
    race_no: r.race_number,
    model_id: r.model_id,
    volatility_score: r.volatility_score,
    top_pick: r.top_pick,
    actual_pattern: r.actualPattern,
    ai_pattern: r.aiPattern,
    bet_patterns: r.betPatterns,
    dist_hit: r.distHit,
    dist_payout: r.distPayout,
    ai_hit: r.aiHit,
  });
  const hitCases = matched
    .filter((r) => r.distHit)
    .sort((a, b) => b.distPayout - a.distPayout)
    .slice(0, 10)
    .map(caseMapper);
  const missCases = matched
    .filter((r) => !r.distHit)
    .slice(0, 10)
    .map(caseMapper);

  // ===== 出力 =====
  console.log("=== 結果サマリ ===");
  console.log(`  対象レース数: ${overall.total_races}`);
  console.log(
    `  出目分布Top10買い  的中率: ${pct(overall.hit_rate)} (${overall.hit_count}/${overall.total_races})`,
  );
  console.log(`  出目分布Top10買い  回収率: ${pct(overall.recovery_rate)}`);
  console.log(
    `  AI単独(3連単1点)   的中率: ${pct(overall.ai_hit_rate)} (${overall.ai_hit_count}/${overall.total_races})`,
  );
  console.log(`  AI単独(3連単1点)   回収率: ${pct(overall.ai_recovery_rate)}`);
  console.log(
    `  lift_vs_ai_only: ${(overall.lift_vs_ai_only * 100).toFixed(1)}pt`,
  );
  console.log("");
  console.log("  会場別 回収率 Top5:");
  for (const v of byVenue.slice(0, 5)) {
    console.log(
      `    ${v.venue_name}(${String(v.venue_code).padStart(2, "0")}): 回収${pct(v.recovery_rate)} 的中${pct(v.hit_rate)} (n=${v.total_races})`,
    );
  }
  console.log("");

  if (!fs.existsSync(args.outputDir))
    fs.mkdirSync(args.outputDir, { recursive: true });
  if (!fs.existsSync(path.join(args.outputDir, "by-venue"))) {
    fs.mkdirSync(path.join(args.outputDir, "by-venue"), { recursive: true });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    mode: args.correctBias ? "correct-bias" : "legacy",
    config: {
      period_days: args.period,
      from_date: getDateNDaysAgoJST(args.period),
      volatility_score_threshold: VOLATILITY_SCORE_THRESHOLD,
      top_n_patterns: TOP_N_PATTERNS,
      correct_bias: args.correctBias,
    },
    notes: args.correctBias
      ? [
          "in_kuzure_probability カラムは DB に存在しないため volatility_score>=60 を代理指標として使用。",
          "outcome_distribution は現スナップショットのみ保持 → 現分布を全期間に適用する近似値。",
          "【correct-bias モード】対象レース: volatility_level=high & score>=60 / top_pick!=1 の2条件のみ。",
          "条件3（rank1=top_pick）は適用しない。レース前に確定する情報のみで母集団を決定（ルックアヘッドバイアス除外）。",
          "買い目: outcome_distribution の first_boat=top_pick パターン Top10 を3連単10点×100円。事前買い目。",
          "的中: top_pick が実際に1着 かつ (rank2,rank3) が出目Top10 に含まれるレース。",
          "recovery_rate がこの戦略の本当の価値。total_races が母集団全体（top_pick が外れたレースも含む）。",
        ]
      : [
          "in_kuzure_probability カラムは DB に存在しないため volatility_score>=60 を代理指標として使用。",
          "outcome_distribution は現スナップショットのみ保持 → 現分布を全期間に適用する近似値。",
          "【legacy モード】対象レース: volatility_level=high & score>=60 / top_pick!=1 / rank1=top_pick の3条件すべて。",
          "条件3でレース結果を見て絞っているためルックアヘッドバイアスあり。回収率は過大評価。",
          "買い目: outcome_distribution の first_boat=top_pick パターン Top10 を3連単10点×100円。",
        ],
    filter_breakdown: {
      high_races_with_result: cntHighWithResult,
      top_pick_not_1: cntTopPickNot1,
      top_pick_won: cntTopPickWon,
      with_distribution_data: matched.length,
    },
    overall,
    by_volatility_level: byVolatilityLevel,
    by_model: byModel,
    by_venue: byVenue,
  };

  if (args.formats.includes("json")) {
    const p = path.join(args.outputDir, "summary.json");
    fs.writeFileSync(p, JSON.stringify(summary, null, 2));
    console.log(`✅ JSON: ${p}`);

    const scp = path.join(args.outputDir, "specific-cases.json");
    fs.writeFileSync(
      scp,
      JSON.stringify(
        {
          generated_at: summary.generated_at,
          mode: summary.mode,
          hit_cases: hitCases,
          miss_cases: missCases,
        },
        null,
        2,
      ),
    );
    console.log(
      `✅ specific-cases: ${scp} (的中${hitCases.length}件/不的中${missCases.length}件)`,
    );

    for (const v of byVenue) {
      const vp = path.join(
        args.outputDir,
        "by-venue",
        `venue-${String(v.venue_code).padStart(2, "0")}.json`,
      );
      fs.writeFileSync(vp, JSON.stringify(v, null, 2));
    }
    console.log(`✅ by-venue: ${byVenue.length}件`);
  }

  if (args.formats.includes("csv")) {
    const p = path.join(args.outputDir, "summary.csv");
    const cols = [
      "venue_code",
      "venue_name",
      "total_races",
      "hit_count",
      "hit_rate",
      "recovery_rate",
      "ai_hit_rate",
      "ai_recovery_rate",
      "lift_vs_ai_only",
    ];
    const lines = [cols.join(",")];
    for (const v of byVenue) {
      lines.push(cols.map((c) => (v[c] != null ? v[c] : "")).join(","));
    }
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
