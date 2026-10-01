/**
 * 修正版: 展開予測パターン × 出目分布の統合分析
 * 最新データで patterns配列が確実に存在する期間を分析
 */

import { supabase } from "../lib/supabaseClient.js";
import fs from "fs/promises";

console.log(`\n=== 修正版: 展開予測パターン × 出目分布統合分析 ===`);

// 最新データで patternsが保存されている期間（約2週間前～7日前）
const startDate = "2026-05-05";
const endDate = "2026-05-15";

console.log(`\n分析期間: ${startDate} ～ ${endDate}`);
console.log(`（最新データでpatternsが保存されている期間）`);
console.log(`データ取得中...`);

let allData = [];
let offset = 0;
const pageSize = 1000;

while (true) {
  const { data: pageData, error } = await supabase
    .from("predictions")
    .select(
      `
      race_id,
      model_id,
      feature_contributions,
      races(
        race_date,
        race_results(rank1, rank2, rank3, payout_trifecta, payout_trio)
      )
    `,
    )
    .eq("model_id", "standard")
    .gte("races.race_date", startDate)
    .lte("races.race_date", endDate)
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.error(`エラー: ${error.message}`);
    break;
  }

  if (!pageData || pageData.length === 0) break;

  allData = allData.concat(pageData);
  offset += pageSize;
  console.log(`  取得済み: ${allData.length}件`);
}

console.log(`\n合計データ: ${allData.length}件`);

// 分析実行
const results = {
  totalData: allData.length,
  analyzedRaces: 0,
  noTurnPred: 0,
  noPatterns: 0,
  noResults: 0,
  pattern0: {
    coverage: { purchased: 0, hits: 0, payouts: 0 },
    filtered: { purchased: 0, hits: 0, payouts: 0 },
  },
  pattern1: {
    coverage: { purchased: 0, hits: 0, payouts: 0 },
    filtered: { purchased: 0, hits: 0, payouts: 0 },
  },
  pattern2: {
    coverage: { purchased: 0, hits: 0, payouts: 0 },
    filtered: { purchased: 0, hits: 0, payouts: 0 },
  },
};

allData.forEach((item) => {
  const turnPred = item.feature_contributions?.turnPrediction;
  if (!turnPred) {
    results.noTurnPred++;
    return;
  }

  const patterns = turnPred.patterns || [];
  if (!patterns.length) {
    results.noPatterns++;
    return;
  }

  const result = item.races?.[0]?.race_results?.[0];
  if (!result || !result.rank1) {
    results.noResults++;
    return;
  }

  results.analyzedRaces++;

  const trifectaKey = [result.rank1, result.rank2, result.rank3]
    .sort((a, b) => a - b)
    .join("-");
  const payout = result.payout_trio || result.payout_trifecta || 0;

  [0, 1, 2].forEach((patIdx) => {
    const pattern = patterns[patIdx];
    if (!pattern) return;

    const patKey = `pattern${patIdx}`;
    const { winnerCourse, secondPlace, thirdPlace, probability } = pattern;

    if (!secondPlace || !thirdPlace) return;

    // 上位3艇の組み合わせ
    const top2nd = Object.entries(secondPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([boat]) => parseInt(boat));
    const top3rd = Object.entries(thirdPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([boat]) => parseInt(boat));

    const combinations = [];
    for (const boat2 of top2nd) {
      for (const boat3 of top3rd) {
        if (
          boat2 !== winnerCourse &&
          boat3 !== winnerCourse &&
          boat3 !== boat2
        ) {
          combinations.push([winnerCourse, boat2, boat3].sort().join("-"));
        }
      }
    }

    // Coverage分析
    if (combinations.length > 0) {
      results[patKey].coverage.purchased += combinations.length;
      if (combinations.includes(trifectaKey)) {
        results[patKey].coverage.hits++;
        results[patKey].coverage.payouts += payout;
      }
    }

    // Filtered分析（確度40%以上）
    const secondProbs = Object.values(secondPlace);
    const thirdProbs = Object.values(thirdPlace);
    const avgSecondProb =
      secondProbs.reduce((a, b) => a + b, 0) / secondProbs.length;
    const avgThirdProb =
      thirdProbs.reduce((a, b) => a + b, 0) / thirdProbs.length;
    const patternConfidence = (probability + avgSecondProb + avgThirdProb) / 3;

    if (patternConfidence >= 0.4 && combinations.length > 0) {
      results[patKey].filtered.purchased += combinations.length;
      if (combinations.includes(trifectaKey)) {
        results[patKey].filtered.hits++;
        results[patKey].filtered.payouts += payout;
      }
    }
  });
});

console.log(`\n分析状況`);
console.log(`  総データ: ${results.totalData}`);
console.log(`  turnPredictionなし: ${results.noTurnPred}`);
console.log(`  patternsなし: ${results.noPatterns}`);
console.log(`  レース結果なし: ${results.noResults}`);
console.log(`  分析対象: ${results.analyzedRaces}`);

if (results.analyzedRaces === 0) {
  console.log(
    `\n注意: 分析対象レースが0件です。patterns配列が古い期間で保存されていない可能性があります。`,
  );
  console.log(
    `最新データ（2026-05-10以降）でのみ patterns配列が利用可能です。`,
  );
} else {
  console.log(`\n分析結果 (${results.analyzedRaces}レース)`);
  console.log(`========================================`);

  [0, 1, 2].forEach((idx) => {
    const patKey = `pattern${idx}`;
    const coverage = results[patKey].coverage;
    const filtered = results[patKey].filtered;

    const covHitRate =
      coverage.purchased > 0
        ? ((coverage.hits / coverage.purchased) * 100).toFixed(1)
        : "0.0";
    const covRecovery =
      coverage.purchased > 0
        ? ((coverage.payouts / (100 * coverage.purchased)) * 100).toFixed(1)
        : "0.0";

    const filtHitRate =
      filtered.purchased > 0
        ? ((filtered.hits / filtered.purchased) * 100).toFixed(1)
        : "0.0";
    const filtRecovery =
      filtered.purchased > 0
        ? ((filtered.payouts / (100 * filtered.purchased)) * 100).toFixed(1)
        : "0.0";

    console.log(
      `\nパターン${idx + 1} (${idx === 0 ? "最高確度" : idx === 1 ? "次点" : "3番目"})`,
    );
    console.log(
      `  Coverage (全て):          購入${coverage.purchased}, 的中${coverage.hits}, 的中率${covHitRate}%, 回収率${covRecovery}%`,
    );
    console.log(
      `  Filtered (確度40%以上):     購入${filtered.purchased}, 的中${filtered.hits}, 的中率${filtHitRate}%, 回収率${filtRecovery}%`,
    );
  });
}

const summary = [0, 1, 2].map((idx) => {
  const patKey = `pattern${idx}`;
  const coverage = results[patKey].coverage;
  const filtered = results[patKey].filtered;
  return {
    pattern: `pattern${idx}`,
    coverage: {
      purchased: coverage.purchased,
      hits: coverage.hits,
      hitRate:
        coverage.purchased > 0
          ? parseFloat(((coverage.hits / coverage.purchased) * 100).toFixed(1))
          : 0,
      recovery:
        coverage.purchased > 0
          ? parseFloat(
              ((coverage.payouts / (100 * coverage.purchased)) * 100).toFixed(
                1,
              ),
            )
          : 0,
    },
    filtered: {
      purchased: filtered.purchased,
      hits: filtered.hits,
      hitRate:
        filtered.purchased > 0
          ? parseFloat(((filtered.hits / filtered.purchased) * 100).toFixed(1))
          : 0,
      recovery:
        filtered.purchased > 0
          ? parseFloat(
              ((filtered.payouts / (100 * filtered.purchased)) * 100).toFixed(
                1,
              ),
            )
          : 0,
    },
  };
});

const outputFile = `data/analysis/turn-outcome-integration-corrected.json`;
await fs.writeFile(
  outputFile,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      period: `${startDate} ～ ${endDate}`,
      note: `最新データでのみpatternsが保存されている期間での分析`,
      totalData: results.totalData,
      analyzedRaces: results.analyzedRaces,
      summary,
    },
    null,
    2,
  ),
);

console.log(`\n結果を ${outputFile} に保存しました`);
