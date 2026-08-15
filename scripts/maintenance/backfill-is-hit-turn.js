/**
 * predictions.is_hit_turn のバックフィル（BOA-174/175/178 Task2、ADR 0013）
 *
 * unified運用開始（2026-08-11）以降、マイグレーション033
 * （predictions.is_hit_turn追加）適用前に確定した過去レースには
 * is_hit_turnが入っていないため、一括計算して埋める。
 *
 * 対象: model_id='unified' かつ is_hit_turn が NULL かつ
 *       feature_contributions.turnPrediction.patterns を持つ予測
 *
 * 使い方:
 *   node scripts/maintenance/backfill-is-hit-turn.js
 */
import {
  supabase,
  fetchAll,
  isSupabaseEnabled,
} from "../lib/supabaseClient.js";
import { isTurnHit } from "../lib/hitCalculator.js";

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  console.log("is_hit_turnがNULLのunified予測を取得中...");
  const predictions = await fetchAll(
    "predictions",
    "prediction_id, race_id, feature_contributions",
    (q) => q.eq("model_id", "unified").is("is_hit_turn", null),
  );
  console.log(`  ${predictions.length}件`);

  if (predictions.length === 0) {
    console.log("✅ バックフィル対象なし");
    return;
  }

  const raceIds = [...new Set(predictions.map((p) => p.race_id))];
  console.log(`race_results取得中... (対象レース: ${raceIds.length}件)`);
  const results = await fetchAll("race_results", "race_id, rank1", (q) =>
    q.in("race_id", raceIds).not("rank1", "is", null),
  );
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));
  console.log(`  ${results.length}件（結果確定済み）`);

  let updated = 0;
  let skippedNoResult = 0;
  let skippedNoPatterns = 0;
  let hits = 0;

  for (const pred of predictions) {
    const result = resultByRaceId.get(pred.race_id);
    if (!result) {
      skippedNoResult++;
      continue; // 未確定レースはスキップ（マイグレーション適用後の通常バッチで処理される）
    }

    const patterns = pred.feature_contributions?.turnPrediction?.patterns;
    if (!Array.isArray(patterns) || patterns.length === 0) {
      skippedNoPatterns++;
      continue;
    }

    const turnHit = isTurnHit(patterns, result.rank1);

    const { error } = await supabase
      .from("predictions")
      .update({ is_hit_turn: turnHit })
      .eq("prediction_id", pred.prediction_id);

    if (error) {
      console.error(
        `  ❌ 更新エラー (prediction_id=${pred.prediction_id}):`,
        error.message,
      );
      continue;
    }

    updated++;
    if (turnHit) hits++;
  }

  console.log("\n✅ バックフィル完了");
  console.log(`  更新: ${updated}件`);
  console.log(
    `  展開予測的中: ${hits}件（${updated > 0 ? ((hits / updated) * 100).toFixed(1) : 0}%）`,
  );
  console.log(`  スキップ（結果未確定）: ${skippedNoResult}件`);
  console.log(`  スキップ（turnPredictionなし）: ${skippedNoPatterns}件`);
}

main();
