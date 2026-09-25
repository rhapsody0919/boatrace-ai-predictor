/**
 * 展開予測ベース 出目分布統合戦略の検証（正当版 / Task #13）
 *
 * ■ 背景と Task #12 からの修正点
 *   Task #12 は predictions.scores（6艇フル予測順位）を前提にしていたが、
 *   scores は 2025-12-02〜2026-01-09 の旧仕様期間しか存在しない。
 *   現行の予測は feature_contributions.turnPrediction（展開予測）を持つ。
 *
 * ■ turnPrediction 実データの制約（本スクリプトで実測・要報告）
 *   predictions.feature_contributions.turnPrediction の中身は:
 *     { technique, probability, distribution{nige,sashi,...}, winnerCourse }
 *   実測の結果:
 *     - winnerCourse は全レース 1（1コース固定）
 *     - technique は全レース "nige"（逃げ固定）
 *     - probability（逃げ確率）のみレースごとに変動（0.26〜0.55+）
 *     - 3モデル（standard/upsetFocus/safeBet）で turnPrediction は完全一致
 *   → turnPrediction は「1コースの逃げ確率」を表す指標であり、
 *     艇ごとの予測順位（フル ranking）も top_pick の導出根拠も持たない。
 *   → よって「展開予測から top_pick を導出」「予測下位N艇を除外」は実装不能。
 *
 * ■ 本スクリプトが実施する正当な分析
 *   現行データで実行可能な形に再定義する:
 *     - top_pick は predictions.top_pick をそのまま使用（モデルの予測1着艇）。
 *     - 展開予測（turnPrediction.distribution.nige = 逃げ確率）は
 *       「AI予測の信頼度メタ情報」として記録・会場別に併記する。
 *     - 出目分布の「出現率（probability, %）」を基準に低確率パターンを除外する
 *       4案（3% / 5% / 10% / 除外なし）を同時評価する。
 *
 * ■ 戦略
 *   対象レース: race_results.rank1 = top_pick。
 *   買い目: outcome_distribution(first_boat=top_pick) のうち
 *           probability >= 閾値 のパターンを全買い（100円/点）。
 *   各案について coverage_rate（除外前の出現率合計に対し残った割合）を測定。
 *
 * ■ メトリクス（案ごと）
 *   total_races / hit_count / hit_rate / recovery_rate / points_per_race /
 *   avg_investment / coverage_rate / lift_vs_ai_only
 *
 * ■ 注意
 *   - outcome_distribution は現スナップショットのみ → 現分布を全期間に適用する近似。
 *   - 対象期間は feature_contributions が存在する 2026-03-06 以降がデフォルト。
 *   - BOA-408（predictions.feature_contributions の3モデル重複解消）以降、
 *     safeBet・upsetFocus行自身の feature_contributions はNULL。nige_probability
 *     （メタ情報）は同一race_idのstandard行の値で補う（値は従来から3モデルで
 *     完全一致していたため、この代替で分析結果自体は変わらない）。model_idでの
 *     絞り込みは行わない（by_modelの内訳がこのスクリプトの主目的のため）。
 *
 * 使い方:
 *   node scripts/analysis/turnprediction-guided-outcome-distribution.js [--period 90] [--from 2026-03-06] [--format json,csv]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// feature_contributions（turnPrediction）が存在する開始日（DB 実測）
const FEATURE_CONTRIB_FROM = "2026-03-06";

// 出目分布 probability は % スケール（0-100）。除外閾値も % で指定。
const APPROACHES = [
  { key: "all", label: "除外なし（全買い）", minProbability: 0 },
  { key: "3pct", label: "出現率3%未満を除外", minProbability: 3 },
  { key: "5pct", label: "出現率5%未満を除外", minProbability: 5 },
  { key: "10pct", label: "出現率10%未満を除外", minProbability: 10 },
];

function parseArgs(argv) {
  const args = {
    from: FEATURE_CONTRIB_FROM,
    to: "9999-99-99",
    format: "json",
    outputDir: path.join(
      __dirname,
      "../../data/analysis/turnprediction-guided-outcome-distribution",
    ),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--from") {
      args.from = next;
      i++;
    } else if (a === "--to") {
      args.to = next;
      i++;
    } else if (a === "--period") {
      // 直近N日。ただし feature_contributions 開始日より前は遡れない。
      const days = parseInt(next, 10);
      const d = new Date(Date.now() - days * 86400000 + 9 * 3600000);
      const calc = d.toISOString().split("T")[0];
      args.from = calc < FEATURE_CONTRIB_FROM ? FEATURE_CONTRIB_FROM : calc;
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

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function pct(v) {
  return (v * 100).toFixed(1) + "%";
}

function venueCodeFromRaceId(raceId) {
  return parseInt(raceId.split("-")[3], 10);
}

async function fetchOutcomeDistribution() {
  const data = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, total_races, probability, avg_payout",
  );
  const byVenueFirst = new Map();
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

async function fetchRaceResults(from, to) {
  const data = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_trifecta",
    (q) =>
      q
        .eq("is_cancelled", false)
        .eq("is_no_race", false)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .gte("race_id", from)
        .lte("race_id", `${to}-99-99`),
  );
  const map = new Map();
  for (const r of data) map.set(r.race_id, r);
  return map;
}

async function fetchPredictions(from, to) {
  // model_id・feature_contributionsどちらでも絞り込まない。BOA-408（standard行にのみ
  // feature_contributionsを書き、safeBet・upsetFocusはNULLにする変更）以降、
  // ここでfeature_contributions非NULLを条件にすると、standard以外のモデル行が
  // 丸ごと除外されbyModelの内訳（本分析の主目的）が壊れる。top_pickはスキーマ上
  // 常にNOT NULLのため、この条件を外しても対象レース数自体は変わらない
  return fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd, feature_contributions, payout_trifecta",
    (q) =>
      q
        .eq("is_shadow", false)
        .gte("race_id", from)
        .lte("race_id", `${to}-99-99`),
  );
}

/**
 * 1レース1モデルを評価。各案の買い目・的中・投資・払戻を算出。
 *
 * @param {Map<string, object>} standardFcByRaceId - race_id → standard行のfeature_contributions。
 *   BOA-408以降safeBet・upsetFocusのfeature_contributionsはNULLになるため、
 *   nige_probability（メタ情報）はstandard行から補う（turnPredictionは3モデルで
 *   常に同一内容だったため、この代替で値は変わらない）
 */
function evaluateRace({
  raceId,
  venueCode,
  raceNumber,
  result,
  pred,
  distByVenueFirst,
  standardFcByRaceId,
}) {
  const topPick = pred.top_pick;
  const actualPattern = `${result.rank1}-${result.rank2}-${result.rank3}`;

  const distKey = `${venueCode}-${topPick}`;
  const allPatterns = distByVenueFirst.get(distKey) ?? [];
  // 除外前の出現率合計（カバレッジの分母）
  const totalProbability = allPatterns.reduce(
    (s, p) => s + (p.probability || 0),
    0,
  );

  // 展開予測メタ情報（逃げ確率）。BOA-408以降safeBet・upsetFocus行自身の
  // feature_contributionsはNULLのため、standard行（同一race_id）の値で補う
  const fc =
    pred.feature_contributions ?? standardFcByRaceId?.get(raceId) ?? null;
  const tp = fc?.turnPrediction;
  const nigeProbability = tp?.distribution?.nige ?? tp?.probability ?? null;

  // AI 単独（1点: top_pick-top_2nd-top_3rd）
  const aiPattern =
    pred.top_2nd != null && pred.top_3rd != null
      ? `${topPick}-${pred.top_2nd}-${pred.top_3rd}`
      : null;
  const aiHit = aiPattern != null && aiPattern === actualPattern;
  const aiPayout = aiHit
    ? pred.payout_trifecta || result.payout_trifecta || 0
    : 0;

  const byApproach = {};
  for (const ap of APPROACHES) {
    const kept = allPatterns.filter((p) => p.probability >= ap.minProbability);
    const betPatterns = kept.map(
      (p) => `${p.first_boat}-${p.second_boat}-${p.third_boat}`,
    );
    const keptProbability = kept.reduce((s, p) => s + (p.probability || 0), 0);
    const points = betPatterns.length;
    const investment = points * 100;
    const hit = betPatterns.includes(actualPattern);
    const payout = hit ? result.payout_trifecta || 0 : 0;
    byApproach[ap.key] = {
      points,
      investment,
      hit,
      payout,
      kept_probability: keptProbability,
      total_probability: totalProbability,
      betPatterns,
    };
  }

  return {
    race_id: raceId,
    venue_code: venueCode,
    race_number: raceNumber,
    model_id: pred.model_id,
    top_pick: topPick,
    nige_probability: nigeProbability,
    actualPattern,
    aiPattern,
    aiHit,
    aiPayout,
    distAvailable: allPatterns.length > 0,
    byApproach,
  };
}

/** 指定案 key で rows を集計 */
function aggregate(rows, key) {
  if (rows.length === 0) {
    return {
      total_races: 0,
      hit_count: 0,
      hit_rate: 0,
      recovery_rate: 0,
      points_per_race: 0,
      avg_investment: 0,
      total_investment: 0,
      total_payout: 0,
      coverage_rate: 0,
      ai_hit_count: 0,
      ai_hit_rate: 0,
      ai_recovery_rate: 0,
      lift_vs_ai_only: 0,
    };
  }
  const n = rows.length;
  let hitCount = 0;
  let totalInvestment = 0;
  let totalPayout = 0;
  let totalPoints = 0;
  let sumKeptProb = 0;
  let sumTotalProb = 0;
  let aiHitCount = 0;
  let aiInvestment = 0;
  let aiPayout = 0;

  for (const r of rows) {
    const e = r.byApproach[key];
    if (e.hit) hitCount++;
    totalInvestment += e.investment;
    totalPayout += e.payout;
    totalPoints += e.points;
    sumKeptProb += e.kept_probability;
    sumTotalProb += e.total_probability;
    if (r.aiHit) aiHitCount++;
    aiInvestment += 100;
    aiPayout += r.aiPayout;
  }

  const recoveryRate = totalInvestment > 0 ? totalPayout / totalInvestment : 0;
  const aiRecoveryRate = aiInvestment > 0 ? aiPayout / aiInvestment : 0;

  return {
    total_races: n,
    hit_count: hitCount,
    hit_rate: round(hitCount / n),
    recovery_rate: round(recoveryRate),
    points_per_race: round(totalPoints / n, 2),
    avg_investment: round(totalInvestment / n, 1),
    total_investment: totalInvestment,
    total_payout: totalPayout,
    // coverage_rate: 残ったパターンの出現率合計 / 除外前の出現率合計
    coverage_rate: round(sumTotalProb > 0 ? sumKeptProb / sumTotalProb : 0),
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

  console.log(
    "=== 展開予測ベース 出目分布統合戦略 検証（正当版 / Task #13）===",
  );
  console.log(`実行: ${new Date().toISOString()}`);
  console.log(`設定: 対象期間=${args.from}〜${args.to}`);
  console.log("");
  console.log("⚠️ データ制約（重要・要報告）:");
  console.log(
    "  - turnPrediction の中身は { technique, probability, distribution, winnerCourse }。",
  );
  console.log(
    "    実測では winnerCourse=1固定 / technique=nige固定 / 3モデルで完全一致。",
  );
  console.log(
    "    → 艇別フル予測順位は持たず『展開予測から top_pick を導出』は不能。",
  );
  console.log(
    "  - 本分析は top_pick（predictions.top_pick）をそのまま使用し、",
  );
  console.log(
    "    出目分布の『出現率』を基準に低確率パターンを除外する4案を比較する。",
  );
  console.log(
    "  - feature_contributions は 2026-03-06 以降のみ存在 → それ以前は遡れない。",
  );
  console.log("");
  console.log("対象レース: race_results.rank1 = top_pick。");
  console.log(
    "買い目: outcome_distribution(first_boat=top_pick) で probability>=閾値 を全買い（100円/点）。",
  );
  console.log("");

  if (!supabase) {
    console.error("❌ Supabase 未設定（SUPABASE_SERVICE_KEY が必要）");
    process.exit(1);
  }

  console.log("→ データ取得中...");
  const distByVenueFirst = await fetchOutcomeDistribution();
  const resultMap = await fetchRaceResults(args.from, args.to);
  const predictions = await fetchPredictions(args.from, args.to);
  // BOA-408以降、standard以外（safeBet・upsetFocus）行のfeature_contributionsは
  // NULLのため、nige_probability（メタ情報）算出時にstandard行の値で補う
  const standardFcByRaceId = new Map(
    predictions
      .filter((p) => p.model_id === "standard" && p.feature_contributions)
      .map((p) => [p.race_id, p.feature_contributions]),
  );
  console.log(
    `  outcome_distribution: ${distByVenueFirst.size} 個の(venue,first)キー`,
  );
  console.log(`  race_results: ${resultMap.size}件`);
  console.log(`  predictions: ${predictions.length}件`);
  console.log("");

  if (predictions.length === 0) {
    console.log("❌ predictions が0件。--from を調整してください。");
    return;
  }

  console.log("→ 対象レース抽出・評価中...");
  let cntPred = 0;
  let cntWithResult = 0;
  let cntTopPickWon = 0;
  let cntDistAvailable = 0;

  const matched = [];
  for (const pred of predictions) {
    cntPred++;
    if (pred.top_pick == null) continue;

    const result = resultMap.get(pred.race_id);
    if (!result) continue;
    cntWithResult++;

    if (result.rank1 !== pred.top_pick) continue;
    cntTopPickWon++;

    const venueCode = venueCodeFromRaceId(pred.race_id);
    const row = evaluateRace({
      raceId: pred.race_id,
      venueCode,
      raceNumber: parseInt(pred.race_id.split("-")[4], 10),
      result,
      pred,
      distByVenueFirst,
      standardFcByRaceId,
    });
    if (!row.distAvailable) continue;
    cntDistAvailable++;
    matched.push(row);
  }

  console.log(`  predictions: ${cntPred}件`);
  console.log(`  + 結果あり: ${cntWithResult}件`);
  console.log(`  + rank1=top_pick（AI予測1着的中）: ${cntTopPickWon}件`);
  console.log(`  + 出目分布データあり（最終対象）: ${cntDistAvailable}件`);
  console.log("");

  if (matched.length === 0) {
    console.log("対象レースが0件のため終了。");
    return;
  }

  // ===== 集計 =====
  const byApproach = {};
  for (const ap of APPROACHES) byApproach[ap.key] = aggregate(matched, ap.key);

  const byModelGroups = groupBy(matched, (r) => r.model_id);
  const byModel = {};
  for (const [modelId, rows] of byModelGroups) {
    byModel[modelId] = {};
    for (const ap of APPROACHES)
      byModel[modelId][ap.key] = aggregate(rows, ap.key);
  }

  const byVenueGroups = groupBy(matched, (r) => r.venue_code);
  const byVenue = [];
  for (const [venueCode, rows] of byVenueGroups) {
    const entry = {
      venue_code: venueCode,
      venue_name: VENUE_NAMES[venueCode] || `会場${venueCode}`,
      by_approach: {},
    };
    for (const ap of APPROACHES)
      entry.by_approach[ap.key] = aggregate(rows, ap.key);
    byVenue.push(entry);
  }
  byVenue.sort(
    (a, b) =>
      b.by_approach["5pct"].recovery_rate - a.by_approach["5pct"].recovery_rate,
  );

  // 実例（5pct 案で 的中10 + 不的中10）
  const caseKey = "5pct";
  const caseMapper = (r) => ({
    race_id: r.race_id,
    venue: VENUE_NAMES[r.venue_code] || `会場${r.venue_code}`,
    race_no: r.race_number,
    model_id: r.model_id,
    top_pick: r.top_pick,
    nige_probability: r.nige_probability,
    actual_pattern: r.actualPattern,
    ai_pattern: r.aiPattern,
    approach: caseKey,
    bet_points: r.byApproach[caseKey].points,
    bet_patterns: r.byApproach[caseKey].betPatterns,
    hit: r.byApproach[caseKey].hit,
    payout: r.byApproach[caseKey].payout,
    ai_hit: r.aiHit,
  });
  const hitCases = matched
    .filter((r) => r.byApproach[caseKey].hit)
    .sort((a, b) => b.byApproach[caseKey].payout - a.byApproach[caseKey].payout)
    .slice(0, 10)
    .map(caseMapper);
  const missCases = matched
    .filter((r) => !r.byApproach[caseKey].hit)
    .slice(0, 10)
    .map(caseMapper);

  // ===== コンソール出力 =====
  console.log("=== 案別 結果サマリ ===");
  console.log(
    "  案        対象  的中率  回収率  買い目  平均投資  カバレッジ  AI単独比",
  );
  for (const ap of APPROACHES) {
    const a = byApproach[ap.key];
    console.log(
      `  ${ap.key.padEnd(6)}  ${String(a.total_races).padStart(5)}  ${pct(
        a.hit_rate,
      ).padStart(6)}  ${pct(a.recovery_rate).padStart(6)}  ${String(
        a.points_per_race,
      ).padStart(5)}点  ¥${String(a.avg_investment).padStart(7)}  ${pct(
        a.coverage_rate,
      ).padStart(
        8,
      )}  ${(a.lift_vs_ai_only * 100 >= 0 ? "+" : "") + (a.lift_vs_ai_only * 100).toFixed(1)}pt`,
    );
  }
  console.log("");
  console.log(`  AI単独(1点) 回収率: ${pct(byApproach.all.ai_recovery_rate)}`);
  console.log("");
  console.log("  会場別 回収率 Top5（5pct案）:");
  for (const v of byVenue.slice(0, 5)) {
    const a = v.by_approach["5pct"];
    console.log(
      `    ${v.venue_name}(${String(v.venue_code).padStart(2, "0")}): 回収${pct(
        a.recovery_rate,
      )} 的中${pct(a.hit_rate)} ${a.points_per_race}点 (n=${a.total_races})`,
    );
  }
  console.log("");

  // ===== ファイル出力 =====
  if (!fs.existsSync(args.outputDir))
    fs.mkdirSync(args.outputDir, { recursive: true });
  for (const sub of ["by-approach", "by-model", "by-venue"]) {
    const p = path.join(args.outputDir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  const config = {
    from_date: args.from,
    to_date: args.to,
    approaches: APPROACHES,
  };
  const notes = [
    "turnPrediction の実データは { technique, probability, distribution, winnerCourse }。",
    "実測で winnerCourse=1固定 / technique=nige固定 / 3モデルで完全一致 → 艇別フル予測順位を持たない。",
    "そのため『展開予測から top_pick を導出』『予測下位N艇を除外』は実装不能。",
    "本分析は top_pick（predictions.top_pick）をそのまま使用し、出目分布の出現率で低確率パターンを除外する。",
    "turnPrediction.distribution.nige（逃げ確率）は各レースの信頼度メタ情報として nige_probability に記録。",
    "feature_contributions は 2026-03-06 以降のみ存在 → 対象期間はそれ以降。BOA-408以降standard以外" +
      "（safeBet・upsetFocus）行自身はNULLのため、同一race_idのstandard行の値で補っている。",
    "対象レース: race_results.rank1 = top_pick（AI予測1着が的中）。",
    "買い目: outcome_distribution(first_boat=top_pick) で probability>=閾値 を全買い（100円/点）。",
    "coverage_rate: 残ったパターンの出現率合計 / 除外前の出現率合計（低確率パターン除外による損失の逆指標）。",
    "outcome_distribution は現スナップショットのみ → 現分布を全期間に適用する近似値。",
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    config,
    notes,
    data_constraints: {
      turn_prediction_winner_course: "always 1 (1コース固定)",
      turn_prediction_technique: "always nige (逃げ固定)",
      turn_prediction_per_model: "identical across standard/upsetFocus/safeBet",
      turn_prediction_usable_signal: "distribution.nige（逃げ確率）のみ変動",
      feature_contributions_available_from: FEATURE_CONTRIB_FROM,
    },
    filter_breakdown: {
      predictions_with_feature_contributions: cntPred,
      with_result: cntWithResult,
      top_pick_won: cntTopPickWon,
      with_distribution_data: cntDistAvailable,
    },
    by_approach: byApproach,
    by_model: byModel,
    by_venue: byVenue,
  };

  if (args.formats.includes("json")) {
    const p = path.join(args.outputDir, "summary.json");
    fs.writeFileSync(p, JSON.stringify(summary, null, 2));
    console.log(`✅ JSON: ${p}`);

    for (const ap of APPROACHES) {
      const ep = path.join(
        args.outputDir,
        "by-approach",
        `approach-${ap.key}.json`,
      );
      const byVenueForAp = byVenue
        .map((v) => ({
          venue_code: v.venue_code,
          venue_name: v.venue_name,
          ...v.by_approach[ap.key],
        }))
        .sort((a, b) => b.recovery_rate - a.recovery_rate);
      const byModelForAp = {};
      for (const [m, levels] of Object.entries(byModel)) {
        byModelForAp[m] = levels[ap.key];
      }
      fs.writeFileSync(
        ep,
        JSON.stringify(
          {
            generated_at: summary.generated_at,
            approach: ap,
            config,
            overall: byApproach[ap.key],
            by_model: byModelForAp,
            by_venue: byVenueForAp,
          },
          null,
          2,
        ),
      );
    }
    console.log(`✅ by-approach: ${APPROACHES.length}件`);

    for (const [modelId, levels] of Object.entries(byModel)) {
      const mp = path.join(args.outputDir, "by-model", `model-${modelId}.json`);
      fs.writeFileSync(
        mp,
        JSON.stringify(
          {
            generated_at: summary.generated_at,
            model_id: modelId,
            config,
            by_approach: levels,
          },
          null,
          2,
        ),
      );
    }
    console.log(`✅ by-model: ${Object.keys(byModel).length}件`);

    for (const v of byVenue) {
      const vp = path.join(
        args.outputDir,
        "by-venue",
        `venue-${String(v.venue_code).padStart(2, "0")}.json`,
      );
      fs.writeFileSync(vp, JSON.stringify(v, null, 2));
    }
    console.log(`✅ by-venue: ${byVenue.length}件`);

    const scp = path.join(args.outputDir, "specific-cases.json");
    fs.writeFileSync(
      scp,
      JSON.stringify(
        {
          generated_at: summary.generated_at,
          approach: caseKey,
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
  }

  if (args.formats.includes("csv")) {
    const p = path.join(args.outputDir, "summary.csv");
    const cols = [
      "approach",
      "total_races",
      "hit_count",
      "hit_rate",
      "recovery_rate",
      "points_per_race",
      "avg_investment",
      "coverage_rate",
      "ai_recovery_rate",
      "lift_vs_ai_only",
    ];
    const lines = [cols.join(",")];
    for (const ap of APPROACHES) {
      const a = byApproach[ap.key];
      lines.push(
        [
          ap.key,
          a.total_races,
          a.hit_count,
          a.hit_rate,
          a.recovery_rate,
          a.points_per_race,
          a.avg_investment,
          a.coverage_rate,
          a.ai_recovery_rate,
          a.lift_vs_ai_only,
        ].join(","),
      );
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
