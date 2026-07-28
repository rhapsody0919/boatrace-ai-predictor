/**
 * イン崩れ指数が高い桐生でのデータ分析
 *
 * 分析内容:
 * - 桐生会場（venue_code=1）
 * - volatility_level = 'high' のレース
 * - 1コース（rank1 != 1）が1着にならなかったレース
 * - これらのレースの配当金を集計
 *
 * 実行: node scripts/analysis/analyze-in-kuzure-1st-boat-upsets.js
 */

import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";

const VENUE_CODE = 1; // 桐生

async function analyzeInKuzureUpsets() {
  console.log("🏁 桐生のイン崩れ×1コース飛び分析\n");

  // 1. 桐生でvolatility_level='high'のレースを取得
  const { data: highVolatilityRaces, error: raceError } = await supabase
    .from("races")
    .select(
      "race_id, race_date, race_number, volatility_score, volatility_level, first_boat_win_rate",
    )
    .eq("venue_code", VENUE_CODE)
    .eq("volatility_level", "high")
    .order("race_date", { ascending: false });

  if (raceError) {
    console.error("❌ レース取得エラー:", raceError.message);
    return;
  }

  if (!highVolatilityRaces || highVolatilityRaces.length === 0) {
    console.log("⚠️ イン崩れ指数highが付いたレースがありません");
    return;
  }

  console.log(`📊 対象レース数: ${highVolatilityRaces.length} 件\n`);

  // 2. 結果テーブルから1コースが1着にならなかったレースを取得
  const raceIds = highVolatilityRaces.map((r) => r.race_id);

  const { data: results, error: resultError } = await supabase
    .from("race_results")
    .select(
      "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta",
    )
    .in("race_id", raceIds);

  if (resultError) {
    console.error("❌ 結果取得エラー:", resultError.message);
    return;
  }

  // 3. 1コースが1着にならなかったレースを抽出
  const upsetRaces = results.filter((r) => r.rank1 !== 1);

  console.log(
    `1コース飛び数: ${upsetRaces.length} 件 / ${results.length} 件 (${((upsetRaces.length / results.length) * 100).toFixed(1)}%)\n`,
  );

  // 4. 配当金の統計
  const tanshoPayout = upsetRaces
    .map((r) => r.payout_win)
    .filter((p) => p !== null);

  const fukushoPayouts = upsetRaces
    .map((r) => r.payout_place_1)
    .filter((p) => p !== null);

  const trifectaPayout = upsetRaces
    .map((r) => r.payout_trifecta)
    .filter((p) => p !== null);

  const stats = (payouts, label) => {
    if (payouts.length === 0) return;
    const avg = payouts.reduce((a, b) => a + b) / payouts.length;
    const min = Math.min(...payouts);
    const max = Math.max(...payouts);
    const high = payouts.filter((p) => p > 5000).length;
    const veryHigh = payouts.filter((p) => p > 10000).length;

    console.log(`${label}`);
    console.log(`  件数: ${payouts.length}`);
    console.log(`  平均: ¥${avg.toFixed(0)}`);
    console.log(`  最小: ¥${min}`);
    console.log(`  最大: ¥${max}`);
    console.log(
      `  5000円超: ${high} 件 (${((high / payouts.length) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  10000円超: ${veryHigh} 件 (${((veryHigh / payouts.length) * 100).toFixed(1)}%)`,
    );
    console.log();
  };

  stats(tanshoPayout, "💰 単勝配当");
  stats(fukushoPayouts, "💰 複勝配当（1番人気）");
  stats(trifectaPayout, "💰 3連単配当");

  // 5. 3連単配当のみで全レースをリスト
  console.log("📋 3連単配当リスト（全110件）");
  console.log("---");

  const upsetRacesWithDate = upsetRaces.map((result) => {
    const race = highVolatilityRaces.find((r) => r.race_id === result.race_id);
    return {
      date: race?.race_date,
      raceNum: race?.race_number,
      raceId: result.race_id,
      rank1: result.rank1,
      rank2: result.rank2,
      rank3: result.rank3,
      trifecta: result.payout_trifecta,
      volatilityScore: race?.volatility_score,
    };
  });

  // 配当金でソート（降順）
  upsetRacesWithDate.sort((a, b) => (b.trifecta || 0) - (a.trifecta || 0));

  upsetRacesWithDate.forEach((r, idx) => {
    console.log(
      `${idx + 1}. ${r.date} R${String(r.raceNum).padStart(2, " ")} (${r.raceId}): ${r.rank1}→${r.rank2}→${r.rank3} | 3連単: ¥${r.trifecta || "N/A"}`,
    );
  });
}

analyzeInKuzureUpsets().catch(console.error);
