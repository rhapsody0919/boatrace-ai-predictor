/**
 * unifiedモデルの複勝的中率・展開的中率を集計し、accuracy_cache に保存する
 * （BOA-179関連、AiAnalysisSection内の複勝予想/展開予測カードの動的実績表示に使う）
 *
 * scripts/analysis/backtest-course-rate-only.js（複勝、1レース1点賭け:
 * topPick→top2ndの順に最初に的中した方を採用）・
 * verify-turn-prediction-accuracy-v6.js（展開、上位パターンのいずれかが
 * 的中すれば的中）と同じ定義に合わせている。ただしこれらの検証スクリプトは
 * predictFirstMark()等を再計算するため低速（40分以上）だが、本スクリプトは
 * predictions テーブルに保存済みの予測結果をrace_resultsと突き合わせるだけ
 * なので数秒〜数十秒で完了する。
 *
 * 使い方:
 *   node scripts/daily/calculate-unified-model-accuracy.js
 */
import {
  supabase,
  fetchAll,
  isSupabaseEnabled,
} from "../lib/supabaseClient.js";

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  console.log("predictions（unified）取得中...");
  const predictions = await fetchAll(
    "predictions",
    "race_id, top_pick, top_2nd, feature_contributions",
    (q) => q.eq("model_id", "unified"),
  );
  console.log(`  ${predictions.length}件`);

  console.log("race_results取得中...");
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, payout_place_1, payout_place_2",
    (q) => q.not("rank1", "is", null),
  );
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));
  console.log(`  ${results.length}件`);

  let placeRaces = 0;
  let placeHits = 0;
  let placePayoutSum = 0;
  let turnRaces = 0;
  let turnHits = 0;

  for (const pred of predictions) {
    const result = resultByRaceId.get(pred.race_id);
    if (!result) continue; // 未確定レースはスキップ

    // 複勝: 1レース1点賭け想定。topPick→top2ndの順に最初に的中した方を採用
    // （scripts/analysis/backtest-course-rate-only.js と同じ定義）
    const actualTop2 = [result.rank1, result.rank2];
    const candidates = [pred.top_pick, pred.top_2nd].filter((n) => n != null);
    if (candidates.length > 0) {
      placeRaces += 1;
      const hitBoat = candidates.find((n) => actualTop2.includes(n));
      if (hitBoat != null) {
        placeHits += 1;
        placePayoutSum +=
          (hitBoat === result.rank1
            ? result.payout_place_1
            : result.payout_place_2) || 0;
      }
    }

    // 展開: 上位パターンのいずれかのwinnerCourseが実際の1着と一致すれば的中
    // （scripts/analysis/verify-turn-prediction-accuracy-v6.js と同じ定義）
    const patterns = pred.feature_contributions?.turnPrediction?.patterns;
    if (Array.isArray(patterns) && patterns.length > 0) {
      turnRaces += 1;
      if (patterns.some((p) => p.winnerCourse === result.rank1)) {
        turnHits += 1;
      }
    }
  }

  const placeInvest = placeRaces * 100;
  const summary = {
    calculatedAt: new Date().toISOString(),
    place: {
      totalRaces: placeRaces,
      hits: placeHits,
      hitRate: placeRaces > 0 ? placeHits / placeRaces : null,
      recoveryRate: placeInvest > 0 ? placePayoutSum / placeInvest : null,
    },
    turn: {
      totalRaces: turnRaces,
      hits: turnHits,
      hitRate: turnRaces > 0 ? turnHits / turnRaces : null,
    },
  };

  console.log("\n=== 複勝（unifiedモデル） ===");
  console.log(
    `${summary.place.totalRaces}件 | 的中率 ${((summary.place.hitRate ?? 0) * 100).toFixed(1)}% | 回収率 ${((summary.place.recoveryRate ?? 0) * 100).toFixed(1)}%`,
  );
  console.log("\n=== 展開（unifiedモデル） ===");
  console.log(
    `${summary.turn.totalRaces}件 | 的中率 ${((summary.turn.hitRate ?? 0) * 100).toFixed(1)}%`,
  );

  const { error } = await supabase.from("accuracy_cache").upsert({
    key: "unified_model_accuracy",
    data: summary,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("❌ accuracy_cache保存エラー:", error.message);
    process.exit(1);
  }
  console.log("\n✅ accuracy_cache（unified_model_accuracy）を更新しました");
}

main();
