/**
 * 会場別重み（avgST, winRate）を分析
 *
 * 実行: node scripts/analysis/analyze-venue-weights.js [VENUE_CODE]
 * 例:   node scripts/analysis/analyze-venue-weights.js 05
 */
import { supabase } from "../lib/supabaseClient.js";

const VENUE_NAMES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
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

async function analyzeVenueWeights(venueCode) {
  try {
    // 過去90日のデータを取得
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const formattedDate = startDate.toISOString().split("T")[0];

    const { data: races, error: raceError } = await supabase
      .from("races")
      .select(
        `
        race_id, race_date, venue_code,
        volatility_score,
        race_results(rank1)
      `,
      )
      .eq("venue_code", parseInt(venueCode, 10))
      .gte("race_date", formattedDate)
      .not("volatility_score", "is", null)
      .order("race_date", { ascending: false });

    if (raceError) throw raceError;

    if (!races || races.length === 0) {
      console.log(`❌ ${VENUE_NAMES[venueCode]} (${venueCode}): データなし`);
      return;
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 会場別重み分析: ${VENUE_NAMES[venueCode]} (${venueCode})`);
    console.log(`分析期間: 過去90日 (${races.length}レース)\n`);

    // レース結果の有無で分類
    const finishedRaces = races.filter(
      (r) => r.race_results && r.race_results.length > 0,
    );
    const pendingRaces = races.filter(
      (r) => !r.race_results || r.race_results.length === 0,
    );

    console.log(`📈 基本統計:`);
    console.log(`  総レース数: ${races.length}`);
    console.log(`  完了レース: ${finishedRaces.length}`);
    console.log(`  未完了レース: ${pendingRaces.length}\n`);

    // スコア分布の詳細統計
    const scores = races.map((r) => r.volatility_score);
    const sorted = [...scores].sort((a, b) => a - b);

    const percentiles = {
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
    };

    console.log(`スコア分布 (全${races.length}件):`);
    console.log(`  最小: ${Math.min(...scores)}`);
    console.log(`  Q1: ${percentiles.p25}`);
    console.log(`  中央: ${percentiles.p50}`);
    console.log(`  Q3: ${percentiles.p75}`);
    console.log(`  P90: ${percentiles.p90}`);
    console.log(`  最大: ${Math.max(...scores)}`);
    console.log(
      `  平均: ${(scores.reduce((a, b) => a + b) / scores.length).toFixed(2)}\n`,
    );

    // 既存の会場別重み参照
    const EXISTING_WEIGHTS = {
      14: { avgST: 0.52, winRate: 0.3 }, // 鳴門
      24: { avgST: 0.5, winRate: 0.32 }, // 大村
      20: { avgST: 0.48, winRate: 0.32 }, // 若松
      15: { avgST: 0.46, winRate: 0.34 }, // 丸亀
      "03": { avgST: 0.46, winRate: 0.34 }, // 江戸川
      17: { avgST: 0.44, winRate: 0.36 }, // 宮島
      16: { avgST: 0.44, winRate: 0.36 }, // 児島
      "09": { avgST: 0.44, winRate: 0.36 }, // 津
    };

    console.log(`📋 既存の会場別重み参照:\n`);
    console.log(`  津 (09) [同等条件で分析可能]:`);
    console.log(`    avgST: 0.44 (デフォルト 0.38)`);
    console.log(`    winRate: 0.36 (デフォルト 0.42)\n`);

    // 推奨重み（スコア分布と既存パターンから推定）
    const scoreRange = Math.max(...scores) - Math.min(...scores);
    let recommendedWeights;

    // スコア分布が狭い → avgST の重みを上げる（ST の予測力が強い可能性）
    if (scoreRange < 12) {
      recommendedWeights = { avgST: 0.45, winRate: 0.35 };
      console.log(`💡 推奨重み (スコア分布が狭い傾向):`);
    } else {
      recommendedWeights = { avgST: 0.44, winRate: 0.36 };
      console.log(`💡 推奨重み (標準的なパターン):`);
    }

    console.log(
      `  avgST: ${recommendedWeights.avgST} (デフォルト 0.38より +${(recommendedWeights.avgST - 0.38).toFixed(2)})`,
    );
    console.log(
      `  winRate: ${recommendedWeights.winRate} (デフォルト 0.42より ${(recommendedWeights.winRate - 0.42).toFixed(2)})`,
    );
    console.log(`  → nigeProb, sigma, venue は変更なし\n`);

    // 実装例
    console.log(`📝 実装例 (scripts/lib/venueParameters.js に追加):\n`);
    console.log(
      `  '${venueCode}': { avgST: ${recommendedWeights.avgST}, winRate: ${recommendedWeights.winRate} }, // ${VENUE_NAMES[venueCode]}\n`,
    );

    console.log(`${"=".repeat(70)}`);

    return {
      venueCode,
      venueName: VENUE_NAMES[venueCode],
      totalRaces: races.length,
      scoreStats: {
        min: Math.min(...scores),
        max: Math.max(...scores),
        range: scoreRange,
        avg: (scores.reduce((a, b) => a + b) / scores.length).toFixed(2),
        median: percentiles.p50,
      },
      recommendedWeights,
    };
  } catch (err) {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  }
}

// メイン実行
const venueCode = (process.argv[2] || "").padStart(2, "0");

if (!venueCode || venueCode === "00") {
  console.log(
    "使用方法: node scripts/analysis/analyze-venue-weights.js [VENUE_CODE]",
  );
  console.log("例: node scripts/analysis/analyze-venue-weights.js 05");
  process.exit(1);
}

await analyzeVenueWeights(venueCode);
