/**
 * unifiedモデルの複勝的中率・展開的中率を集計し、accuracy_cache に保存する
 * （BOA-179関連、AiAnalysisSection内の展開予測カードの動的実績表示に使う）
 *
 * 展開: verify-turn-prediction-accuracy-v6.js（上位パターンのいずれかが的中すれば的中）
 * と同じ定義。ただしこの検証スクリプトはpredictFirstMark()等を再計算するため低速
 * （40分以上）だが、本スクリプトはpredictionsテーブルに保存済みの予測結果を
 * race_resultsと突き合わせるだけなので数秒〜数十秒で完了する。
 *
 * 複勝: 2026-08-14修正（BOA-180）。旧実装は「◎○のうち都合よく的中した方の
 * 払戻を、1点分(100円)の投資額で割る」という実行不可能な計算方式で、真の
 * 回収率を約1.5倍に水増ししていた（scripts/analysis/backtest-course-rate-only.js
 * も同じ方式だったため、この方式で算出された「回収率146.0%」等の数値が
 * ブログ・FAQ等の公開コンテンツにも波及していた）。実際に◎○を両方100円ずつ
 * （計200円）買った場合の真の回収率に修正する。的中判定は「◎○のいずれかが
 * 2着以内」のまま変更していない（的中率自体は水増しされていなかったため）。
 * ※現在、複勝予想UI自体はBOA-180の対応（既存公開コンテンツとの整合性含む）が
 * 完了するまで撤去中（PR#287）。本スクリプトはUI復活時に備えて維持する。
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
  let placeInvest = 0;
  let turnRaces = 0;
  let turnHits = 0;

  for (const pred of predictions) {
    const result = resultByRaceId.get(pred.race_id);
    if (!result) continue; // 未確定レースはスキップ

    // 複勝: ◎○それぞれに100円ずつ賭けた場合の実際の的中率・回収率。
    // ◎○のいずれかが2着以内なら「的中」とカウントし（従来通り）、払戻は
    // ◎○それぞれが2着以内なら加算する（両方的中したレースは両方の払戻を合算）
    const actualTop2 = [result.rank1, result.rank2];
    const candidates = [pred.top_pick, pred.top_2nd].filter((n) => n != null);
    if (candidates.length > 0) {
      placeRaces += 1;
      placeInvest += candidates.length * 100;
      let hitAny = false;
      for (const boat of candidates) {
        if (actualTop2.includes(boat)) {
          hitAny = true;
          placePayoutSum +=
            (boat === result.rank1
              ? result.payout_place_1
              : result.payout_place_2) || 0;
        }
      }
      if (hitAny) placeHits += 1;
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
