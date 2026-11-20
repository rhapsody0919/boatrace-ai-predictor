/**
 * unifiedモデルのイン崩れ指数（volatilityPercentile）の的中精度を集計し、
 * accuracy_cache に保存する（BOA-177）
 *
 * scripts/daily/calculate-accuracy.js の calculateVolatilityStats() と同じ出力shape
 * （baseline/byLevel）にすることで、既存の VolatilityAccuracySection コンポーネントを
 * そのまま再利用できるようにしている。
 *
 * レベル分けは src/components/race/VolatilityDisplay.jsx の実際の閾値
 * （percentile >= 0.7 → 警戒 / <= 0.3 → 堅い / それ以外 → 標準）に合わせる。
 * volatilityPercentileIsFallback === false の行のみを対象とする
 * （フォールバック値0.5は「実測ではない」ため、含めると精度検証の意味が無くなる）。
 *
 * 使い方:
 *   node scripts/daily/calculate-unified-volatility-accuracy.js
 */
import {
  supabase,
  fetchAll,
  isSupabaseEnabled,
} from "../lib/supabaseClient.js";
import { isNoRaceResult } from "../lib/raceOutcomeFilters.js";
import { volatilityByLevel } from "../lib/accuracyCacheStats.js";
import { VENUE_NAMES } from "../lib/venueNames.js";

const MODEL_ID = "unified";

function levelOf(percentile) {
  if (percentile >= 0.7) return "high"; // 警戒
  if (percentile <= 0.3) return "low"; // 堅い
  return "medium"; // 標準
}

function joinPredictionsWithResults(predictions, results) {
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));
  return predictions
    .map((pred) => {
      const result = resultByRaceId.get(pred.race_id);
      if (!result || result.is_cancelled || isNoRaceResult(result)) return null;
      const percentile = pred.feature_contributions?.volatilityPercentile;
      if (typeof percentile !== "number") return null;
      // race_id形式: YYYY-MM-DD-VV-RR
      const venueCode = parseInt(pred.race_id.split("-")[3], 10);
      return {
        venueCode,
        level: levelOf(percentile),
        upset: result.rank1 !== 1,
      };
    })
    .filter(Boolean);
}

// 会場別: 「イン崩れ注意（高）」ラベル時の実際のイン崩れ率 vs 会場全体の平均
// （VolatilityAccuracySection.jsxが期待するshapeに合わせる。BOA-175）
function buildByVenue(joined) {
  const venueCodes = [...new Set(joined.map((r) => r.venueCode))];
  return venueCodes
    .map((venueCode) => {
      const all = joined.filter((r) => r.venueCode === venueCode);
      const high = all.filter((r) => r.level === "high");
      const allUpset = all.filter((r) => r.upset).length;
      const highUpset = high.filter((r) => r.upset).length;
      return {
        venueCode: String(venueCode).padStart(2, "0"),
        venueName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
        highRaceCount: high.length,
        highUpsetRate:
          high.length > 0
            ? parseFloat(((highUpset / high.length) * 100).toFixed(1))
            : 0,
        baselineUpsetRate: parseFloat(
          ((allUpset / all.length) * 100).toFixed(1),
        ),
        isReliable: high.length >= 5,
      };
    })
    .sort((a, b) => b.highUpsetRate - a.highUpsetRate);
}

function buildVolatilitySummary(joined) {
  const totalUpset = joined.filter((r) => r.upset).length;
  const baseline = {
    raceCount: joined.length,
    upsetRate: parseFloat(((totalUpset / joined.length) * 100).toFixed(1)),
  };
  const byLevel = volatilityByLevel(joined, baseline);
  const byVenue = buildByVenue(joined);
  return { baseline, byLevel, byVenue };
}

function logVolatilitySummary({ baseline, byLevel, byVenue }) {
  console.log("\n=== イン崩れ指数（unifiedモデル、実測値のみ） ===");
  console.log(
    `全体: ${baseline.raceCount}件 | イン崩れ率 ${baseline.upsetRate}%`,
  );
  for (const level of ["low", "medium", "high"]) {
    if (!byLevel[level]) continue;
    console.log(
      `  ${level}: ${byLevel[level].raceCount}件 | イン崩れ率 ${byLevel[level].upsetRate}% (差分 ${byLevel[level].lift >= 0 ? "+" : ""}${byLevel[level].lift}pt)`,
    );
  }
  console.log(`  会場別: ${byVenue.length}会場分集計`);
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  console.log(
    "predictions（unified、フォールバックでない実測値のみ）取得中...",
  );
  const predictions = await fetchAll(
    "predictions",
    "race_id, feature_contributions",
    (q) =>
      q
        .eq("model_id", MODEL_ID)
        .eq("feature_contributions->>volatilityPercentileIsFallback", "false").order("race_id").order("model_id").order("prediction_id"),
  );
  console.log(`  ${predictions.length}件`);

  console.log("race_results取得中...");
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, is_cancelled, race_status",
    (q) => q.not("rank1", "is", null).order("race_id"),
  );
  console.log(`  ${results.length}件`);

  const joined = joinPredictionsWithResults(predictions, results);

  if (joined.length === 0) {
    console.log("⚠️ 結果確定済み・実測値ありのデータがまだありません");
    return;
  }

  const summary = buildVolatilitySummary(joined);
  logVolatilitySummary(summary);

  const { error } = await supabase.from("accuracy_cache").upsert({
    key: "unified_volatility_accuracy",
    data: summary,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("❌ accuracy_cache保存エラー:", error.message);
    process.exit(1);
  }
  console.log(
    "\n✅ accuracy_cache（unified_volatility_accuracy）を更新しました",
  );
}

main();
