/**
 * 新AI予想モデル「unified」発走前バッチ（Task9b、FR4 3連単参考情報）
 *
 * オッズ（race_odds.trifecta_all）が必要なため、朝の日次バッチ
 * （generate-unified-predictions.js、Task9a）とは別バッチにした（plan.md参照）。
 * generate-moriarty-recommendations.js のパターン（bet_recommendationsへの書き込み、
 * EV閾値による分類）を踏襲するが、モリアーティのような事前学習済み校正器は使わず、
 * unifiedModel.js の combinedProbability（1着×2着×3着の同時確率）をそのままEV算出に使う。
 *
 * EV閾値は backtest-unified-model.js のグリッドサーチ結果（2026-08-12〜13、1週間分）に基づく:
 *   EV>=1.2で回収率78.8%が最良。EV>=1.5以上は急落（tail risk、過学習の懸念）するため
 *   'strong_bet'（閾値をさらに引き上げた強気推奨）は設定しない。
 *
 * ⚠️ Task9aで生成した predictions.feature_contributions.turnPrediction を再利用し、
 *   turnPrediction の二重計算を避ける（当日中はracer_aggregated_stats等の変動が
 *   ほぼ無いため、朝の計算結果を流用して問題ない）。
 *
 * 使い方:
 *   node scripts/daily/generate-unified-trifecta-reference.js
 *   node scripts/daily/generate-unified-trifecta-reference.js --date=2026-08-13 --dry-run
 */

import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { calculateUnifiedScores } from "../lib/unifiedModel.js";
import { fetchRaceIndicatorData } from "../lib/raceIndicatorData.js";
import { latestByRaceId } from "../lib/latestByRaceId.js";

const MODEL_ID = "unified";
const EV_THRESHOLD_BET = 1.2;
const EV_THRESHOLD_NEUTRAL = 0.8;

function parseArgs(argv = process.argv.slice(2)) {
  return { dryRun: argv.includes("--dry-run") };
}

async function fetchTodayUnifiedPredictions(date) {
  // 前方一致LIKEはインデックスに乗らないため範囲条件で絞る（moriartyと同じ理由）
  const { data, error } = await supabase
    .from("predictions")
    .select("race_id, feature_contributions")
    .eq("model_id", MODEL_ID)
    .eq("is_shadow", false)
    .gte("race_id", date)
    .lt("race_id", `${date}~`);
  if (error) throw new Error(`predictions取得エラー: ${error.message}`);
  return data || [];
}

async function fetchLatestTrifectaAll(raceIds) {
  const rows = await fetchAll(
    "race_odds",
    "race_id, captured_at, trifecta_all",
    (q) => q.in("race_id", raceIds).not("trifecta_all", "is", null).order("race_id").order("captured_at"),
  );
  return latestByRaceId(rows);
}

function classify(ev) {
  if (ev >= EV_THRESHOLD_BET) return "bet";
  if (ev >= EV_THRESHOLD_NEUTRAL) return "neutral";
  return "skip";
}

async function fetchEntriesWithStats(raceId, racerStatsCache) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select(
      "boat_number, racer_id, win_rate, local_win_rate, motor_2rate, grade",
    )
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries || entries.length < 6) return null;

  const racerIdsToFetch = entries
    .map((e) => e.racer_id)
    .filter((id) => id != null && !racerStatsCache.has(id));
  if (racerIdsToFetch.length > 0) {
    const { data: statsRows } = await supabase
      .from("racer_aggregated_stats")
      .select("racer_id, avg_st, course_race_counts")
      .in("racer_id", racerIdsToFetch)
      .eq("venue_code", 0);
    for (const s of statsRows ?? []) racerStatsCache.set(s.racer_id, s);
  }
  return entries;
}

function toPlayers(entries) {
  return entries.map((e) => ({
    number: e.boat_number,
    course: e.boat_number,
    racerId: e.racer_id,
    winRate: e.win_rate,
    localWinRate: e.local_win_rate,
    motor2Rate: e.motor_2rate,
    grade: e.grade,
  }));
}

function bestCandidate(patterns, trifectaAll) {
  const candidates = patterns
    .filter((p) => p.first && p.second && p.third)
    .map((p) => {
      const combo = `${p.first}-${p.second}-${p.third}`;
      const odds = trifectaAll[combo] ?? null;
      return {
        combo,
        odds,
        probability: p.combinedProbability ?? 0,
        ev: odds != null ? odds * (p.combinedProbability ?? 0) : null,
      };
    })
    .filter((c) => c.odds != null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.ev > a.ev ? b : a));
}

function toRecommendation(raceId, best) {
  return {
    race_id: raceId,
    model_id: MODEL_ID,
    recommendation: classify(best.ev),
    reasons: {
      combo: best.combo,
      odds: best.odds,
      probability: Math.round(best.probability * 100000) / 100000,
    },
    expected_value: Math.round(best.ev * 100) / 100,
    expected_hit_rate: Math.round(best.probability * 10000) / 10000,
    expected_payout: Math.round(best.odds * 100),
  };
}

// 1レース分。戻り値: null=数えずに飛ばす（オッズ・展開・出走表が欠ける）、{ rec: null }=候補なし、{ rec }=推奨
async function recommendForRace(pred, trifectaRow, racerStatsCache) {
  if (!trifectaRow) return null; // オッズ未取得（発走直前まで待つ必要あり）

  const turnPrediction = pred.feature_contributions?.turnPrediction;
  if (!turnPrediction) return null;

  const entries = await fetchEntriesWithStats(pred.race_id, racerStatsCache);
  if (!entries) return null;

  const indicatorData = await fetchRaceIndicatorData(
    pred.race_id,
    entries.map((e) => ({ boatNumber: e.boat_number, racerId: e.racer_id })),
  );
  const { patterns } = calculateUnifiedScores(
    toPlayers(entries),
    turnPrediction,
    indicatorData,
    racerStatsCache,
  );

  const best = bestCandidate(patterns, trifectaRow.trifecta_all);
  return { rec: best ? toRecommendation(pred.race_id, best) : null };
}

function logBreakdown(recommendations) {
  console.log(`\n📊 ${recommendations.length}件の推奨を生成しました`);
  const byRecommendation = { bet: 0, neutral: 0, skip: 0 };
  for (const r of recommendations) byRecommendation[r.recommendation] += 1;
  console.log(
    `  内訳: bet=${byRecommendation.bet} neutral=${byRecommendation.neutral} skip=${byRecommendation.skip}`,
  );
}

async function writeRecommendations(recommendations) {
  const targetRaceIds = recommendations.map((r) => r.race_id);
  const { error: deleteError } = await supabase
    .from("bet_recommendations")
    .delete()
    .in("race_id", targetRaceIds)
    .eq("model_id", MODEL_ID);
  if (deleteError) {
    console.error("❌ bet_recommendations削除エラー:", deleteError.message);
    return;
  }

  let writeFailed = false;
  for (let i = 0; i < recommendations.length; i += 1000) {
    const batch = recommendations.slice(i, i + 1000);
    const { error } = await supabase.from("bet_recommendations").insert(batch);
    if (error) {
      console.error("❌ bet_recommendations書き込みエラー:", error.message);
      writeFailed = true;
    }
  }
  if (writeFailed) {
    console.error(
      `⚠️ 一部書き込みに失敗しました。実際にDBへ反映された件数を必ず確認してください`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `✅ bet_recommendations: ${recommendations.length}件書き込み完了`,
  );
}

async function main() {
  const { dryRun } = parseArgs();
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase未設定");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}${dryRun ? " [DRY-RUN]" : ""}`);

  const unifiedPredictions = await fetchTodayUnifiedPredictions(date);
  if (unifiedPredictions.length === 0) {
    console.log(
      "📭 predictions(model_id=unified)が未生成です。先にgenerate-unified-predictions.jsを実行してください",
    );
    return;
  }
  const raceIds = unifiedPredictions.map((p) => p.race_id);
  console.log(`🎯 対象: ${raceIds.length}レース`);

  const trifectaAllMap = await fetchLatestTrifectaAll(raceIds);
  console.log(`💰 オッズ取得済み: ${trifectaAllMap.size}レース`);

  const racerStatsCache = new Map();
  const recommendations = [];

  let processed = 0;
  for (const pred of unifiedPredictions) {
    const got = await recommendForRace(
      pred,
      trifectaAllMap.get(pred.race_id),
      racerStatsCache,
    );
    if (!got) continue;
    processed += 1;
    if (!got.rec) continue;
    recommendations.push(got.rec);
    if (processed % 50 === 0)
      console.log(`  ${processed}/${unifiedPredictions.length}件処理...`);
  }

  logBreakdown(recommendations);

  if (dryRun) {
    console.log("[DRY-RUN] Supabase書き込みはスキップ");
    console.log(JSON.stringify(recommendations[0], null, 2));
    return;
  }

  if (recommendations.length === 0) return;

  await writeRecommendations(recommendations);
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
