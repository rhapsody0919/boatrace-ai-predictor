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
 * ※複勝予想UIはBOA-174/175/178（unified一本化）でページ本文からは完全撤去済み。
 * 本スクリプトのplace集計自体は将来の再設計に備えて維持している。
 *
 * turn.byVenue: 展開予測的中率の会場別内訳（2026-08-15追加）。会場によって
 * 実測的中率に差がある（例: 尼崎91.7% vs 桐生68.1%）ことが判明したため追加。
 *
 * 使い方:
 *   node scripts/daily/calculate-unified-model-accuracy.js
 */
import {
  supabase,
  fetchAll,
  isSupabaseEnabled,
} from "../lib/supabaseClient.js";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

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
  const turnByVenue = new Map(); // venueCode -> { total, hits }

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
      const hit = patterns.some((p) => p.winnerCourse === result.rank1);
      if (hit) turnHits += 1;

      // 会場別集計（race_id形式: YYYY-MM-DD-VV-RR）
      const venueCode = parseInt(pred.race_id.split("-")[3], 10);
      if (!turnByVenue.has(venueCode)) {
        turnByVenue.set(venueCode, { total: 0, hits: 0 });
      }
      const venueStats = turnByVenue.get(venueCode);
      venueStats.total += 1;
      if (hit) venueStats.hits += 1;
    }
  }

  const turnVenueBreakdown = Array.from(turnByVenue.entries())
    .map(([venueCode, v]) => ({
      venueCode: String(venueCode).padStart(2, "0"),
      venueName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
      totalRaces: v.total,
      hitRate:
        v.total > 0 ? parseFloat(((v.hits / v.total) * 100).toFixed(1)) : 0,
      isReliable: v.total >= 20,
    }))
    .sort((a, b) => b.hitRate - a.hitRate);

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
      byVenue: turnVenueBreakdown,
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
  console.log(`  会場別: ${turnVenueBreakdown.length}会場分集計`);

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
