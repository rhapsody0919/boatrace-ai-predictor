/**
 * AI予測順位 × 出目分布の統合戦略検証
 *
 * 仮説:
 *   AI（各モデル）の予測順位を「補助情報」として出目分布を活用する。
 *   AI が予測した1着艇（top_pick）が実際に1着になったレースで、
 *   その艇の出目分布パターンから「AI予測の下位N艇」を除外して購入すると、
 *   信頼度の低い買い目を削り、回収率と買い目数のバランスが改善する。
 *
 * 戦略（例: standard が「2-4-3-1-5-6」と予測した場合）:
 *   1. outcome_distribution から first_boat = 2（予測1着艇）の全パターンを取得
 *   2. AI予測順位の下位N艇を 2着・3着 から除外
 *      - exclude-bottom 2 なら 下位2艇（5,6）を除外: 2-5-*, 2-6-*, 2-*-5, 2-*-6 を買わない
 *   3. 残ったパターンを全て購入（100円 × 残パターン数）
 *
 * 対象レース:
 *   1. predictions.scores が存在する（6艇フル予測順位が取れる）
 *   2. race_results.rank1 = predictions.top_pick（AI予測の1着が的中）
 *   ※「AI予測の1着が当たった場合」の効果を測る分析のため条件2は意図的に適用する。
 *      これは Task #11 のようなルックアヘッドではなく、
 *      「AI予測1着が当たる前提でその後の2-3着をどう絞るか」という条件付き戦略の検証。
 *
 * メトリクス:
 *   total_races       : 対象レース数
 *   hit_count/hit_rate: 3連単的中レース数・的中率
 *   recovery_rate     : Σ払戻 / Σ投資
 *   points_per_race   : 平均買い目数
 *   avg_investment    : 平均投資額（points_per_race × 100円）
 *   lift_vs_ai_only   : AI単独（top_pick-top_2nd-top_3rd 1点）との回収率差
 *
 * 注意:
 *   - predictions.scores は 2025-12-02 〜 2026-01-09 の期間のみ DB に存在する。
 *     それ以降は scores が null のため、デフォルト対象期間をこの範囲にしている。
 *   - --from / --to で対象期間を明示指定可能。
 *   - outcome_distribution は現スナップショットのみ保持 → 現分布を全期間に適用する近似。
 *
 * 使い方:
 *   node scripts/analysis/ai-guided-outcome-distribution.js \
 *     [--exclude-bottom 2] [--from 2025-12-02] [--to 2026-01-09] [--format json,csv]
 *
 *   --exclude-bottom 0/1/2/3 で除外艇数を指定。
 *   除外0/1/2/3 を比較したい場合は4回実行する（summary には常に全水準を記録）。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// predictions.scores が存在する期間（DB 実測）
const DEFAULT_FROM = "2025-12-02";
const DEFAULT_TO = "2026-01-09";
const EXCLUSION_LEVELS = [0, 1, 2, 3];

function parseArgs(argv) {
  const args = {
    excludeBottom: 2,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    format: "json",
    outputDir: path.join(
      __dirname,
      "../../data/analysis/ai-guided-outcome-distribution",
    ),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--exclude-bottom") {
      args.excludeBottom = parseInt(next, 10);
      i++;
    } else if (a === "--from") {
      args.from = next;
      i++;
    } else if (a === "--to") {
      args.to = next;
      i++;
    } else if (a === "--format") {
      args.format = next;
      i++;
    } else if (a === "--output-dir") {
      args.outputDir = next;
      i++;
    } else if (a === "--period") {
      // 後方互換: --period N → 直近N日（ただし scores が無いため非推奨）
      const days = parseInt(next, 10);
      const d = new Date(Date.now() - days * 86400000 + 9 * 3600000);
      args.from = d.toISOString().split("T")[0];
      args.to = "9999-99-99";
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

// scores オブジェクト { "1": 4045, ... } → スコア降順の艇番配列 [1,4,2,5,3,6]
function rankingFromScores(scores) {
  if (!scores) return null;
  const entries = Object.entries(scores)
    .map(([boat, sc]) => [parseInt(boat, 10), Number(sc)])
    .filter(([b, s]) => Number.isFinite(b) && Number.isFinite(s));
  if (entries.length !== 6) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([b]) => b);
}

// 出目分布を venue_code × first_boat でインデックス化（probability 降順）
async function fetchOutcomeDistribution() {
  const data = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, total_races, probability, avg_payout", (q) => q.order("id"),
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
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    "race_id, rank1, rank2, rank3, payout_trio",
    (q) =>
      q
        .eq("is_cancelled", false)
        .eq("is_no_race", false)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .gte("race_id", from)
        .lte("race_id", `${to}-99-99`).order("race_id"),
  );
  const map = new Map();
  for (const r of data) map.set(r.race_id, r);
  return map;
}

async function fetchPredictions(from, to) {
  return fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd, scores, payout_trio",
    (q) =>
      q
        .eq("is_shadow", false)
        .not("scores", "is", null)
        .gte("race_id", from)
        .lte("race_id", `${to}-99-99`).order("race_id").order("model_id").order("prediction_id"),
  );
}

function venueCodeFromRaceId(raceId) {
  // race_id 形式: YYYY-MM-DD-{venue_pad}-{race_no}
  const parts = raceId.split("-");
  return parseInt(parts[3], 10);
}

/**
 * 1レース1モデル分の評価。
 * 除外水準ごとの買い目・的中・投資・払戻を算出して返す。
 */
function evaluateRace({
  raceId,
  venueCode,
  raceNumber,
  result,
  pred,
  ranking,
  distByVenueFirst,
}) {
  const topPick = pred.top_pick;
  const actualPattern = `${result.rank1}-${result.rank2}-${result.rank3}`;

  const distKey = `${venueCode}-${topPick}`;
  const allPatterns = distByVenueFirst.get(distKey) ?? [];

  // AI 単独（1点）
  const aiPattern =
    pred.top_2nd != null && pred.top_3rd != null
      ? `${topPick}-${pred.top_2nd}-${pred.top_3rd}`
      : null;
  const aiHit = aiPattern != null && aiPattern === actualPattern;
  const aiPayout = aiHit ? pred.payout_trio || result.payout_trio || 0 : 0;

  // 除外水準ごとに評価
  const byExclusion = {};
  for (const N of EXCLUSION_LEVELS) {
    // AI予測順位の下位 N 艇（top_pick 自体は除外対象にしない）
    const excluded = new Set(ranking.slice(6 - N));
    excluded.delete(topPick); // 念のため: 予測1着艇は常に残す

    const bets = allPatterns.filter(
      (p) => !excluded.has(p.second_boat) && !excluded.has(p.third_boat),
    );
    const betPatterns = bets.map(
      (p) => `${p.first_boat}-${p.second_boat}-${p.third_boat}`,
    );
    const points = betPatterns.length;
    const investment = points * 100;
    const hit = betPatterns.includes(actualPattern);
    const payout = hit ? result.payout_trio || 0 : 0;

    byExclusion[N] = { points, investment, hit, payout, betPatterns };
  }

  return {
    race_id: raceId,
    venue_code: venueCode,
    race_number: raceNumber,
    model_id: pred.model_id,
    top_pick: topPick,
    ranking,
    actualPattern,
    aiPattern,
    aiHit,
    aiPayout,
    distAvailable: allPatterns.length > 0,
    byExclusion,
  };
}

/** 指定除外水準 N で rows を集計 */
function aggregate(rows, N) {
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
  let aiHitCount = 0;
  let aiInvestment = 0;
  let aiPayout = 0;

  for (const r of rows) {
    const e = r.byExclusion[N];
    if (e.hit) hitCount++;
    totalInvestment += e.investment;
    totalPayout += e.payout;
    totalPoints += e.points;
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

  console.log("=== AI予測順位 × 出目分布 統合戦略検証 ===");
  console.log(`実行: ${new Date().toISOString()}`);
  console.log(
    `設定: 対象期間=${args.from}〜${args.to}, exclude-bottom=${args.excludeBottom}`,
  );
  console.log("");
  console.log("⚠️ 注意事項:");
  console.log(
    `  - predictions.scores（6艇フル予測順位）は ${DEFAULT_FROM}〜${DEFAULT_TO} の期間のみ DB に存在。`,
  );
  console.log(
    "    それ以降は scores が null のためデフォルト対象期間をこの範囲に設定。",
  );
  console.log(
    "  - outcome_distribution は現スナップショットのみ → 現分布を全期間に適用する近似。",
  );
  console.log("");
  console.log(
    "対象レース: scores あり & rank1=top_pick（AI予測1着が的中したレース）。",
  );
  console.log(
    "買い目: outcome_distribution(first_boat=top_pick) から AI予測下位N艇を 2-3着から除外し残り全買い。",
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
  console.log(
    `  outcome_distribution: ${distByVenueFirst.size} 個の(venue,first)キー`,
  );
  console.log(`  race_results: ${resultMap.size}件`);
  console.log(`  predictions(scores あり): ${predictions.length}件`);
  console.log("");

  if (predictions.length === 0) {
    console.log(
      "❌ scores を持つ predictions が0件。対象期間を --from/--to で調整してください。",
    );
    return;
  }

  // ===== 対象レース抽出 + 評価 =====
  console.log("→ 対象レース抽出・評価中...");
  let cntScores = 0;
  let cntWithResult = 0;
  let cntTopPickWon = 0;
  let cntDistAvailable = 0;

  const matched = [];
  for (const pred of predictions) {
    cntScores++;
    if (pred.top_pick == null) continue;

    const ranking = rankingFromScores(pred.scores);
    if (!ranking) continue;

    const result = resultMap.get(pred.race_id);
    if (!result) continue;
    cntWithResult++;

    // 条件: AI予測の1着が的中したレース
    if (result.rank1 !== pred.top_pick) continue;
    cntTopPickWon++;

    const venueCode = venueCodeFromRaceId(pred.race_id);
    const row = evaluateRace({
      raceId: pred.race_id,
      venueCode,
      raceNumber: parseInt(pred.race_id.split("-")[4], 10),
      result,
      pred,
      ranking,
      distByVenueFirst,
    });
    if (!row.distAvailable) continue;
    cntDistAvailable++;
    matched.push(row);
  }

  console.log(`  scores あり予測: ${cntScores}件`);
  console.log(`  + 結果あり: ${cntWithResult}件`);
  console.log(`  + rank1=top_pick（AI予測1着的中）: ${cntTopPickWon}件`);
  console.log(`  + 出目分布データあり（最終対象）: ${cntDistAvailable}件`);
  console.log("");

  if (matched.length === 0) {
    console.log("対象レースが0件のため終了。");
    return;
  }

  // ===== 集計: 除外水準ごと =====
  const byExclusion = {};
  for (const N of EXCLUSION_LEVELS) {
    byExclusion[N] = aggregate(matched, N);
  }

  // モデル別 × 除外水準
  const byModelGroups = groupBy(matched, (r) => r.model_id);
  const byModel = {};
  for (const [modelId, rows] of byModelGroups) {
    byModel[modelId] = {};
    for (const N of EXCLUSION_LEVELS) {
      byModel[modelId][N] = aggregate(rows, N);
    }
  }

  // 会場別 × 除外水準
  const byVenueGroups = groupBy(matched, (r) => r.venue_code);
  const byVenue = [];
  for (const [venueCode, rows] of byVenueGroups) {
    const venueEntry = {
      venue_code: venueCode,
      venue_name: VENUE_NAMES[venueCode] || `会場${venueCode}`,
      by_exclusion: {},
    };
    for (const N of EXCLUSION_LEVELS) {
      venueEntry.by_exclusion[N] = aggregate(rows, N);
    }
    byVenue.push(venueEntry);
  }
  // 指定された exclude-bottom 水準の回収率でソート
  byVenue.sort(
    (a, b) =>
      b.by_exclusion[args.excludeBottom].recovery_rate -
      a.by_exclusion[args.excludeBottom].recovery_rate,
  );

  // 実例: 指定 exclude-bottom 水準で 的中例10 + 不的中例10
  const N0 = args.excludeBottom;
  const caseMapper = (r) => ({
    race_id: r.race_id,
    venue: VENUE_NAMES[r.venue_code] || `会場${r.venue_code}`,
    race_no: r.race_number,
    model_id: r.model_id,
    top_pick: r.top_pick,
    predicted_ranking: r.ranking,
    actual_pattern: r.actualPattern,
    ai_pattern: r.aiPattern,
    exclude_bottom: N0,
    bet_points: r.byExclusion[N0].points,
    bet_patterns: r.byExclusion[N0].betPatterns,
    hit: r.byExclusion[N0].hit,
    payout: r.byExclusion[N0].payout,
    ai_hit: r.aiHit,
  });
  const hitCases = matched
    .filter((r) => r.byExclusion[N0].hit)
    .sort((a, b) => b.byExclusion[N0].payout - a.byExclusion[N0].payout)
    .slice(0, 10)
    .map(caseMapper);
  const missCases = matched
    .filter((r) => !r.byExclusion[N0].hit)
    .slice(0, 10)
    .map(caseMapper);

  // ===== コンソール出力 =====
  console.log("=== 除外水準別 結果サマリ ===");
  console.log("  N  対象  的中率   回収率   買い目数  平均投資  AI単独比");
  for (const N of EXCLUSION_LEVELS) {
    const a = byExclusion[N];
    console.log(
      `  ${N}  ${String(a.total_races).padStart(4)}  ${pct(a.hit_rate).padStart(6)}  ${pct(
        a.recovery_rate,
      ).padStart(7)}  ${String(a.points_per_race).padStart(6)}点  ¥${String(
        a.avg_investment,
      ).padStart(
        6,
      )}  ${(a.lift_vs_ai_only * 100 >= 0 ? "+" : "") + (a.lift_vs_ai_only * 100).toFixed(1)}pt`,
    );
  }
  console.log("");
  console.log(`  AI単独(1点) 回収率: ${pct(byExclusion[0].ai_recovery_rate)}`);
  console.log("");
  console.log(`  会場別 回収率 Top5（exclude-bottom=${N0}）:`);
  for (const v of byVenue.slice(0, 5)) {
    const a = v.by_exclusion[N0];
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
  for (const sub of ["by-exclusion", "by-model"]) {
    const p = path.join(args.outputDir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  const config = {
    from_date: args.from,
    to_date: args.to,
    exclude_bottom_requested: args.excludeBottom,
    exclusion_levels: EXCLUSION_LEVELS,
  };
  const notes = [
    `predictions.scores（6艇フル予測順位）は ${DEFAULT_FROM}〜${DEFAULT_TO} の期間のみ DB に存在。それ以降は null。`,
    "そのため対象期間をこの範囲にしている。直近90日は scores が無いため本分析は不可。",
    "outcome_distribution は現スナップショットのみ保持 → 現分布を全期間に適用する近似値。",
    "対象レース: scores あり & rank1=top_pick（AI予測1着が的中したレース）。",
    "これは『AI予測1着が当たった前提で、その後の2-3着を予測下位N艇除外で絞る』条件付き戦略の検証。",
    "買い目: outcome_distribution(first_boat=top_pick) から AI予測下位N艇を 2着・3着から除外し残り全買い（100円/点）。",
    "予測下位N艇は scores 昇順の下位N艇。top_pick 自体は除外対象から常に外す。",
    "by_exclusion: 除外0（全買い）/1/2/3 の比較。recovery_rate と points_per_race のバランスで最適水準を判断。",
  ];

  const summary = {
    generated_at: new Date().toISOString(),
    config,
    notes,
    filter_breakdown: {
      predictions_with_scores: cntScores,
      with_result: cntWithResult,
      top_pick_won: cntTopPickWon,
      with_distribution_data: cntDistAvailable,
    },
    by_exclusion: byExclusion,
    by_model: byModel,
    by_venue: byVenue,
  };

  if (args.formats.includes("json")) {
    const p = path.join(args.outputDir, "summary.json");
    fs.writeFileSync(p, JSON.stringify(summary, null, 2));
    console.log(`✅ JSON: ${p}`);

    for (const N of EXCLUSION_LEVELS) {
      const ep = path.join(args.outputDir, "by-exclusion", `exclude-${N}.json`);
      const byVenueForN = byVenue
        .map((v) => ({
          venue_code: v.venue_code,
          venue_name: v.venue_name,
          ...v.by_exclusion[N],
        }))
        .sort((a, b) => b.recovery_rate - a.recovery_rate);
      const byModelForN = {};
      for (const [m, levels] of Object.entries(byModel)) {
        byModelForN[m] = levels[N];
      }
      fs.writeFileSync(
        ep,
        JSON.stringify(
          {
            generated_at: summary.generated_at,
            exclude_bottom: N,
            config,
            overall: byExclusion[N],
            by_model: byModelForN,
            by_venue: byVenueForN,
          },
          null,
          2,
        ),
      );
    }
    console.log(`✅ by-exclusion: ${EXCLUSION_LEVELS.length}件`);

    for (const [modelId, levels] of Object.entries(byModel)) {
      const mp = path.join(args.outputDir, "by-model", `model-${modelId}.json`);
      fs.writeFileSync(
        mp,
        JSON.stringify(
          {
            generated_at: summary.generated_at,
            model_id: modelId,
            config,
            by_exclusion: levels,
          },
          null,
          2,
        ),
      );
    }
    console.log(`✅ by-model: ${Object.keys(byModel).length}件`);

    const scp = path.join(args.outputDir, "specific-cases.json");
    fs.writeFileSync(
      scp,
      JSON.stringify(
        {
          generated_at: summary.generated_at,
          exclude_bottom: N0,
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
      "exclude_bottom",
      "total_races",
      "hit_count",
      "hit_rate",
      "recovery_rate",
      "points_per_race",
      "avg_investment",
      "ai_recovery_rate",
      "lift_vs_ai_only",
    ];
    const lines = [cols.join(",")];
    for (const N of EXCLUSION_LEVELS) {
      const a = byExclusion[N];
      lines.push(
        [
          N,
          a.total_races,
          a.hit_count,
          a.hit_rate,
          a.recovery_rate,
          a.points_per_race,
          a.avg_investment,
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
