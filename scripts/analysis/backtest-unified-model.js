/**
 * 新AI予想モデル「unified」のバックテスト（AI予想モデル大規模改修 Task7, FR10）
 *
 * unifiedModel.js のロジックを過去レースに適用し、3連単の的中率・回収率をシミュレーションする。
 * scripts/analysis/verify-poirot.js のパターン（--from/--to引数、newAcc/add/fmt集計）を踏襲。
 *
 * ⚠️ オッズ制約（2026-08-12判明、spec.md訂正済み）: 全120通りの3連単オッズ（race_odds.trifecta_all、
 * 022マイグレーション）は2026-07-12開始で約1ヶ月・830レース分のみ。EV計算・バックテストの対象は
 * この期間に限られる。
 * ⚠️ race_results の列名は英日逆転: payout_trio が3連単の払戻（scripts/lib/payoutCalculator.js参照）。
 *
 * 集計方針（v2、2026-08-12根本修正）:
 * - EVは combinedProbability（1着×2着×3着の同時確率）× オッズで算出する
 * - 「EV最大1点（フィルタなし）」: 常に何か買った場合のベースライン
 * - 「EVフィルタ後（EV>=閾値のみ賭ける）」: 実運用想定。期待値マイナスのレースは見送る
 * - 参考として「展開パターン最大3点、全部買った場合」の回収率
 *
 * 使い方:
 *   node scripts/analysis/backtest-unified-model.js                # trifecta_allがある全期間
 *   node scripts/analysis/backtest-unified-model.js --from=2026-07-12 --to=2026-08-01
 *   node scripts/analysis/backtest-unified-model.js --ev=1.2        # EV閾値を変更（デフォルト1.0）
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import { calculateUnifiedScores } from "../lib/unifiedModel.js";
import {
  calculateVolatilityComposite,
  toVolatilityPercentile,
} from "../lib/volatilityFactors.js";
import { fetchRaceIndicatorData } from "../lib/raceIndicatorData.js";

const BET_YEN = 100;

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  const ev = get("ev");
  return { from: get("from"), to: get("to"), ev: ev ? parseFloat(ev) : 1.0 };
}

function newAcc() {
  return { bets: 0, hits: 0, payout: 0 };
}

function add(acc, hit, payout) {
  acc.bets += 1;
  if (hit) {
    acc.hits += 1;
    acc.payout += payout;
  }
}

function fmt(acc) {
  const invest = acc.bets * BET_YEN;
  const hitRate = acc.bets ? ((acc.hits / acc.bets) * 100).toFixed(1) : "-";
  const recovery = invest ? ((acc.payout / invest) * 100).toFixed(1) : "-";
  return `${String(acc.bets).padStart(5)}件 | 的中 ${hitRate.padStart(5)}% | 回収 ${recovery.padStart(6)}%`;
}

async function fetchTargetRaces(from, to) {
  // ⚠️ Supabaseのデフォルトlimitは1000行。race_odds は同一race_idに複数captured_atの
  // スナップショットがあり行数が対象レース数を上回るため、fetchAllで.range()ページネーションする
  const data = await fetchAll("race_odds", "race_id, trifecta_all", (q) => {
    let query = q.not("trifecta_all", "is", null);
    if (from) query = query.gte("race_id", from);
    if (to) query = query.lte("race_id", to);
    return query;
  });
  // race_idごとに最新のtrifecta_allのみ使う（同一race_idで複数captured_atが存在するため）
  const byRace = new Map();
  for (const row of data) {
    byRace.set(row.race_id, row.trifecta_all);
  }
  return byRace;
}

async function buildRaceContext(raceId, racerStatsCache) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select(
      "boat_number, racer_id, win_rate, local_win_rate, motor_2rate, grade",
    )
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries || entries.length < 6) return null;

  const { data: raceRow } = await supabase
    .from("races")
    .select("venue_code")
    .eq("race_id", raceId)
    .single();
  if (!raceRow) return null;

  const { data: conditions } = await supabase
    .from("race_conditions")
    .select("wind_speed, wave_height")
    .eq("race_id", raceId)
    .maybeSingle();

  const racerIdsToFetch = entries
    .map((e) => e.racer_id)
    .filter((id) => id != null && !racerStatsCache.has(id));
  if (racerIdsToFetch.length > 0) {
    const { data: statsRows } = await supabase
      .from("racer_aggregated_stats")
      .select(
        "racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts",
      )
      .in("racer_id", racerIdsToFetch)
      .eq("venue_code", 0);
    for (const s of statsRows ?? []) racerStatsCache.set(s.racer_id, s);
  }

  const players = entries.map((e) => ({
    number: e.boat_number,
    course: e.boat_number,
    racerId: e.racer_id,
    winRate: e.win_rate,
    localWinRate: e.local_win_rate,
    motor2Rate: e.motor_2rate,
    grade: e.grade,
  }));

  const turnPredictionPlayers = entries.map((e) => {
    const stats = racerStatsCache.get(e.racer_id);
    return {
      boatNumber: e.boat_number,
      course: e.boat_number,
      avgST: stats?.avg_st ?? null,
      stStddev: stats?.st_stddev ?? null,
      attackDistribution: stats?.attack_distribution || null,
      defenseDistribution: stats?.defense_distribution || null,
      courseRaceCounts: stats?.course_race_counts || null,
      motor2Rate: e.motor_2rate,
      grade: e.grade,
      globalWinRate: e.win_rate,
      localWinRate: e.local_win_rate,
    };
  });

  return {
    players,
    turnPredictionPlayers,
    venueCode: raceRow.venue_code,
    raceConditions: {
      venueCode: raceRow.venue_code,
      windSpeed: conditions?.wind_speed ?? null,
      waveHeight: conditions?.wave_height ?? null,
    },
    entriesForIndicator: entries.map((e) => ({
      boatNumber: e.boat_number,
      racerId: e.racer_id,
    })),
  };
}

function volatilityBucket(percentile) {
  if (percentile < 0.33) return "低（本命）";
  if (percentile < 0.67) return "中（標準）";
  return "高（穴）";
}

async function main() {
  const { from, to, ev: EV_THRESHOLD } = parseArgs();
  if (!supabase) {
    console.error("Supabase未設定");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   新AI予想モデル(unified) バックテスト                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log("対象レース取得中...");
  const oddsMap = await fetchTargetRaces(from, to);
  const raceIds = [...oddsMap.keys()].sort();
  console.log(
    `  ${raceIds.length}件（trifecta_allが存在する期間: 2026-07-12〜）\n`,
  );

  // race_idを大量にin()へ渡すとURLが長大化しfetchが失敗するためチャンク分割する
  const RACE_ID_CHUNK = 300;
  const resultRows = [];
  for (let i = 0; i < raceIds.length; i += RACE_ID_CHUNK) {
    const chunk = raceIds.slice(i, i + RACE_ID_CHUNK);
    const rows = await fetchAll(
      "race_results",
      "race_id, rank1, rank2, rank3, payout_trio, is_cancelled, is_no_race",
      (q) => q.in("race_id", chunk),
    );
    resultRows.push(...rows);
  }
  const resultMap = new Map(resultRows.map((r) => [r.race_id, r]));

  const racerStatsCache = new Map();

  // 会場別に複合スコアの分布を作るため2パス構成: 1パス目でcomposite値を集める
  const compositeByVenue = new Map();
  const raceComputations = [];

  console.log("展開予測・AIスコア算出中...");
  let processed = 0;
  for (const raceId of raceIds) {
    const result = resultMap.get(raceId);
    if (!result || result.is_cancelled || result.is_no_race) continue;

    const ctx = await buildRaceContext(raceId, racerStatsCache);
    if (!ctx) continue;

    const turnPrediction = predictFirstMark(
      ctx.turnPredictionPlayers,
      ctx.raceConditions,
    );
    const volatility = calculateVolatilityComposite(
      ctx.players.map((p) => ({ number: p.number, winRate: p.winRate })),
      ctx.venueCode,
      turnPrediction,
      ctx.turnPredictionPlayers.map((p) => ({
        boatNumber: p.boatNumber,
        avgST: p.avgST,
      })),
    );

    if (!compositeByVenue.has(ctx.venueCode))
      compositeByVenue.set(ctx.venueCode, []);
    compositeByVenue.get(ctx.venueCode).push(volatility.composite);

    raceComputations.push({ raceId, result, ctx, turnPrediction, volatility });

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${raceIds.length}件処理...`);
  }
  console.log(`  ${raceComputations.length}件を対象に集計\n`);

  console.log("11指標データ取得・AIスコア算出中...");
  // v3（2026-08-12 EV閾値グリッドサーチ対応）: レース単位の計算結果を保存しておき、
  // 複数のEV閾値・会場・荒れ度帯で1回のモデル計算から集計し直せるようにする
  const raceResults = [];

  let done = 0;
  for (const {
    raceId,
    result,
    ctx,
    turnPrediction,
    volatility,
  } of raceComputations) {
    const indicatorData = await fetchRaceIndicatorData(
      raceId,
      ctx.entriesForIndicator,
    );
    const { patterns } = calculateUnifiedScores(
      ctx.players,
      turnPrediction,
      indicatorData,
      racerStatsCache,
    );

    const trifectaAll = oddsMap.get(raceId) || {};
    // v2（2026-08-12根本修正）: EVは combinedProbability（1着×2着×3着の同時確率）で算出する。
    // 旧実装は pattern.probability（1着確率のみ）を使っており、2着・3着の確からしさを
    // 無視していたため「EV最大1点」が「全パターン参考」より悪化する逆転結果を生んでいた
    const candidates = patterns
      .filter((p) => p.first && p.second && p.third)
      .map((p) => {
        const combo = `${p.first}-${p.second}-${p.third}`;
        const odds = trifectaAll[combo] ?? null;
        return {
          combo,
          odds,
          ev: odds != null ? odds * (p.combinedProbability ?? 0) : null,
        };
      })
      .filter((c) => c.odds != null);

    if (candidates.length === 0) {
      done += 1;
      continue;
    }

    const actualTrio = `${result.rank1}-${result.rank2}-${result.rank3}`;
    const best = candidates.reduce((a, b) => (b.ev > a.ev ? b : a));
    const hit = best.combo === actualTrio;
    const payout = hit ? result.payout_trio || 0 : 0;

    const venueDist = compositeByVenue.get(ctx.venueCode) || [];
    const percentile = toVolatilityPercentile(volatility.composite, venueDist);
    const bucket = volatilityBucket(percentile);

    raceResults.push({
      venueCode: ctx.venueCode,
      bucket,
      best,
      hit,
      payout,
      candidates,
      actualTrio,
      allPayout: result.payout_trio || 0,
    });

    done += 1;
    if (done % 100 === 0)
      console.log(`  ${done}/${raceComputations.length}件処理...`);
  }

  // === EV閾値グリッドサーチ（全体） ===
  const EV_GRID = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0];
  console.log("\n=== EV閾値別 全体集計 ===");
  for (const threshold of EV_GRID) {
    const acc = newAcc();
    for (const r of raceResults) {
      if (r.best.ev >= threshold) add(acc, r.hit, r.payout);
    }
    console.log(`EV>=${String(threshold).padStart(4)}: ${fmt(acc)}`);
  }

  // 以降の会場別・荒れ度帯別・全体サマリーは --ev で指定した閾値（デフォルト1.0）を使う
  const overall = { best: newAcc(), filtered: newAcc(), allPatterns: newAcc() };
  const byVenue = new Map();
  const byBucket = new Map();
  for (const r of raceResults) {
    add(overall.best, r.hit, r.payout);
    if (r.best.ev >= EV_THRESHOLD) add(overall.filtered, r.hit, r.payout);
    for (const c of r.candidates) {
      add(
        overall.allPatterns,
        c.combo === r.actualTrio,
        c.combo === r.actualTrio ? r.allPayout : 0,
      );
    }

    if (!byVenue.has(r.venueCode)) byVenue.set(r.venueCode, newAcc());
    if (r.best.ev >= EV_THRESHOLD)
      add(byVenue.get(r.venueCode), r.hit, r.payout);

    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, newAcc());
    if (r.best.ev >= EV_THRESHOLD) add(byBucket.get(r.bucket), r.hit, r.payout);
  }

  console.log("\n=== 全体 ===");
  console.log(`EV最大1点（フィルタなし、常に何か買う）: ${fmt(overall.best)}`);
  console.log(
    `EVフィルタ後（EV>=${EV_THRESHOLD}のみ賭ける、実運用想定）: ${fmt(overall.filtered)}`,
  );
  console.log(
    `展開パターン全点（参考、最大3点/レース）: ${fmt(overall.allPatterns)}`,
  );

  console.log("\n=== 会場別（EVフィルタ後） ===");
  for (const [venue, acc] of [...byVenue.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    console.log(`会場${String(venue).padStart(2, "0")}: ${fmt(acc)}`);
  }

  console.log("\n=== 荒れ度帯別（EVフィルタ後、会場内パーセンタイル） ===");
  for (const bucket of ["低（本命）", "中（標準）", "高（穴）"]) {
    const acc = byBucket.get(bucket) || newAcc();
    console.log(`${bucket}: ${fmt(acc)}`);
  }

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
