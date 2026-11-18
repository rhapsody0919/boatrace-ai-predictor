// Accuracy Calculation Script
// Supabaseから予測結果を集計し、models統計と accuracy_cache を更新する（3モデル×4券種対応）

import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import {
  summarizeHits,
  computeStats,
  jstDateStr,
  buildVolatilityStats,
  accuracyPeriods,
  predsInMonth,
  buildModelCache,
} from "../lib/accuracyCacheStats.js";

export { summarizeHits, computeStats };

// Calculate statistics for a model (4券種: win/place/trifecta/trio) — overall のみ
async function calculateModelStats(modelId) {
  // 失敗は例外にする。以前は null を返し、そのモデルが抜けたまま accuracy_cache を書いていた（BOA-391）。
  // モデルを絞れば1レース1行なので race_id で一意に並ぶ
  const allPredictions = await fetchAll(
    "predictions",
    "race_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
    (q) =>
      q.eq("model_id", modelId).not("is_hit_win", "is", null).order("race_id"),
  );

  if (allPredictions.length === 0) {
    return {
      totalPredictions: 0,
      hitRateWin: 0,
      hitRatePlace: 0,
      hitRateTrifecta: 0,
      hitRateTrio: 0,
      recoveryRateWin: 0,
      recoveryRatePlace: 0,
      recoveryRateTrifecta: 0,
      recoveryRateTrio: 0,
    };
  }

  const h = summarizeHits(allPredictions);
  return {
    totalPredictions: allPredictions.length,
    hitRateWin: h.win.hitRate,
    hitRatePlace: h.place.hitRate,
    hitRateTrifecta: h.trifecta.hitRate,
    hitRateTrio: h.trio.hitRate,
    recoveryRateWin: h.win.recoveryRate,
    recoveryRatePlace: h.place.recoveryRate,
    recoveryRateTrifecta: h.trifecta.recoveryRate,
    recoveryRateTrio: h.trio.recoveryRate,
  };
}

// predictions テーブルから指定範囲を全件取得（ページネーション付き）
async function fetchPredictionsRange(startDate, endDate) {
  const adjustedEnd = endDate ? `${endDate}-99-99` : null;
  // 失敗は例外にする。以前は途中までの結果で accuracy_cache を upsert していた（BOA-391）。
  // 1レースにモデルの数だけ行があるため、race_id・model_id で一意に並べる
  return fetchAll(
    "predictions",
    "race_id, model_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
    (q) => {
      let query = q.gte("race_id", startDate).not("is_hit_win", "is", null);
      if (adjustedEnd) query = query.lte("race_id", adjustedEnd);
      return query.order("race_id").order("model_id");
    },
  );
}

// イン崩れ予測精度を集計（直近90日の races × race_results）
async function calculateVolatilityStats() {
  const now = new Date();
  const ninetyDaysAgoStr = jstDateStr(
    new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
  );

  // races・race_results を取得。失敗は例外にする（以前は null を返し、その null が volatilityStats として
  // そのままキャッシュに書かれていた。BOA-391）
  const races = await fetchAll(
    "races",
    "race_id, venue_code, volatility_level, race_grade",
    (q) =>
      q
        .gte("race_date", ninetyDaysAgoStr)
        .not("volatility_level", "is", null)
        .order("race_id"),
  );
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, is_cancelled, race_status",
    (q) => q.gte("race_id", ninetyDaysAgoStr).order("race_id"),
  );

  const built = buildVolatilityStats(races, results);
  if (!built) return null;

  console.log(
    `  volatilityStats: ${built.joinedCount}件集計完了 (high=${built.stats.byLevel.high?.raceCount ?? 0}件)`,
  );

  return { ...built.stats, lastUpdated: new Date().toISOString() };
}

// accuracy_cache テーブルに全統計を書き込む
async function buildAndStoreAccuracyCache() {
  const now = new Date();
  const periods = accuracyPeriods(now);
  const { thisYear, thisMonth, ninetyDaysAgoStr } = periods;

  console.log("\n📊 accuracy_cache 用データ取得中...");

  // 過去90日を1回取得すれば 7日・今月・先月・6ヶ月分すべてカバーできる
  const allRecentPredictions = await fetchPredictionsRange(
    ninetyDaysAgoStr,
    null,
  );
  const thisMonthPredictions = predsInMonth(
    allRecentPredictions,
    thisYear,
    thisMonth,
  );
  const lastMonthPredictions = predsInMonth(
    allRecentPredictions,
    periods.lastYear,
    periods.lastMonth,
  );

  // models テーブルから全モデルの overall 統計を取得
  const { data: modelsRows, error: modelsError } = await supabase
    .from("models")
    .select(
      "model_id, total_predictions, hit_rate_win, hit_rate_place, hit_rate_trifecta, hit_rate_trio, recovery_rate_win, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio",
    );

  if (modelsError) {
    console.error("  models テーブル取得エラー:", modelsError.message);
    return false;
  }

  const modelIds = ["standard", "safeBet", "upsetFocus"];
  const cacheModels = {};

  for (const modelId of modelIds) {
    const built = buildModelCache(modelId, {
      periods,
      modelRow: modelsRows?.find((m) => m.model_id === modelId),
      allRecentPredictions,
      thisMonthPredictions,
      lastMonthPredictions,
    });
    cacheModels[modelId] = built.entry;

    console.log(
      `  ${modelId}: 今月=${built.thisMonthCount}件, 先月=${built.lastMonthCount}件, 90日=${allRecentPredictions.filter((p) => p.model_id === modelId).length}件`,
    );
  }

  console.log("\n🌪️ イン崩れ予測精度を集計中...");
  const volatilityStats = await calculateVolatilityStats();

  const cacheData = {
    lastUpdated: new Date().toISOString(),
    volatilityStats,
    models: cacheModels,
  };

  const { error: upsertError } = await supabase.from("accuracy_cache").upsert({
    key: "accuracy_summary",
    data: cacheData,
    updated_at: new Date().toISOString(),
  });

  if (upsertError) {
    console.error("  ❌ accuracy_cache UPSERT エラー:", upsertError.message);
    return false;
  }

  console.log("  ✅ accuracy_cache 更新完了");
  return true;
}

// Main function
async function calculateAccuracy() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  console.log("Starting accuracy calculation from Supabase...\n");

  const models = ["standard", "safeBet", "upsetFocus"];
  const modelStats = {};

  for (const modelId of models) {
    console.log(`Calculating ${modelId}...`);
    const stats = await calculateModelStats(modelId);

    if (stats) {
      modelStats[modelId] = stats;
      console.log(`  Total: ${stats.totalPredictions}`);
      console.log(
        `    単勝  的中=${(stats.hitRateWin * 100).toFixed(1)}%, 回収=${(stats.recoveryRateWin * 100).toFixed(1)}%`,
      );
      console.log(
        `    複勝  的中=${(stats.hitRatePlace * 100).toFixed(1)}%, 回収=${(stats.recoveryRatePlace * 100).toFixed(1)}%`,
      );
      console.log(
        `    3連複 的中=${(stats.hitRateTrifecta * 100).toFixed(1)}%, 回収=${(stats.recoveryRateTrifecta * 100).toFixed(1)}%`,
      );
      console.log(
        `    3連単 的中=${(stats.hitRateTrio * 100).toFixed(1)}%, 回収=${(stats.recoveryRateTrio * 100).toFixed(1)}%`,
      );
    }
  }

  // Supabaseのmodelsテーブルを更新
  console.log("\n📤 Supabaseのmodels統計を更新中...");

  for (const [modelId, stats] of Object.entries(modelStats)) {
    const { error } = await supabase
      .from("models")
      .update({
        total_predictions: stats.totalPredictions,
        hit_rate_win: stats.hitRateWin,
        hit_rate_place: stats.hitRatePlace,
        hit_rate_trifecta: stats.hitRateTrifecta,
        hit_rate_trio: stats.hitRateTrio,
        recovery_rate_win: stats.recoveryRateWin,
        recovery_rate_place: stats.recoveryRatePlace,
        recovery_rate_trifecta: stats.recoveryRateTrifecta,
        recovery_rate_trio: stats.recoveryRateTrio,
        last_evaluated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("model_id", modelId);

    if (error) {
      console.error(`  ❌ ${modelId}更新エラー:`, error.message);
    } else {
      console.log(`  ✅ ${modelId} 更新完了`);
    }
  }

  // accuracy_cache テーブルに全統計を保存（API のキャッシュミス時に高速参照するため）
  await buildAndStoreAccuracyCache();

  console.log("\n✅ 統計更新完了");
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  calculateAccuracy().catch((error) => {
    console.error("❌ 統計更新エラー:", error);
    process.exit(1);
  });
}
