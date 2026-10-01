/**
 * 正しいデータ基盤での再分析（修正版3）
 * シンプルなクエリで全データ取得後、ローカルでフィルタリング
 */

import { supabase } from "../lib/supabaseClient.js";
import fs from "fs/promises";

console.log(`\n=== 正確版: patterns配列を使った展開予測統合分析 ===\n`);

const today = new Date();
const startDate = new Date(today);
startDate.setDate(startDate.getDate() - 21);
const endDate = new Date(today);
endDate.setDate(endDate.getDate() - 14);

const startDateStr = startDate.toISOString().split("T")[0];
const endDateStr = endDate.toISOString().split("T")[0];

console.log(`分析期間: ${startDateStr} ～ ${endDateStr}`);
console.log(`(3週間前～2週間前。レース結果確定確保)\n`);
console.log(`データ取得中...`);

// Step 1: predictionsテーブルから対象期間のデータを取得（predicted_at でフィルタ）
let allPredictions = [];
let offset = 0;
const pageSize = 500;

while (true) {
  const { data: pagePreds } = await supabase
    .from("predictions")
    .select(`race_id, model_id, feature_contributions`)
    .eq("model_id", "standard")
    .gte("predicted_at", startDateStr)
    .lte("predicted_at", endDateStr)
    .range(offset, offset + pageSize - 1);

  if (!pagePreds || pagePreds.length === 0) break;
  allPredictions = allPredictions.concat(pagePreds);
  offset += pageSize;
}

console.log(`  predictions: ${allPredictions.length}件`);

// Step 2: racesテーブルから対象期間のデータを取得（race_results を持つものに限定）
let allRaces = [];
offset = 0;

while (true) {
  const { data: pageRaces } = await supabase
    .from("races")
    .select(
      `race_id, race_date, race_results!inner(rank1, rank2, rank3, payout_trifecta, payout_trio)`,
    )
    .gte("race_date", startDateStr)
    .lte("race_date", endDateStr)
    .range(offset, offset + pageSize - 1);

  if (!pageRaces || pageRaces.length === 0) break;
  allRaces = allRaces.concat(pageRaces);
  offset += pageSize;
}

console.log(`  races (with results): ${allRaces.length}件\n`);

// Step 3: ローカルでマージ
const raceMap = Object.fromEntries(
  allRaces.map((r) => [r.race_id, r.race_results?.[0] || r.race_results]),
);

const mergedData = allPredictions
  .filter((p) => raceMap[p.race_id])
  .map((p) => ({
    race_id: p.race_id,
    result: raceMap[p.race_id],
    turnPred: p.feature_contributions?.turnPrediction,
  }));

console.log(`分析統計`);
console.log(`  マージ後: ${mergedData.length}レース`);
console.log(
  `  patterns: ${mergedData.filter((m) => m.turnPred?.patterns?.length > 0).length}件\n`,
);

// Step 4: 分析実行
const results = {
  strategies: {
    patternTop3: { purchased: 0, hits: 0, payouts: 0 },
    patternTop2: { purchased: 0, hits: 0, payouts: 0 },
    boatStrengthFiltered: { purchased: 0, hits: 0, payouts: 0 },
    patternWithStrengthFilter: { purchased: 0, hits: 0, payouts: 0 },
  },
};

let analyzed = 0;

mergedData.forEach((item) => {
  const turnPred = item.turnPred;
  if (!turnPred || !turnPred.patterns || !turnPred.patterns.length) return;

  const result = item.result;
  if (!result || !result.rank1) return;

  analyzed++;
  const patterns = turnPred.patterns;
  const trifectaKey = [result.rank1, result.rank2, result.rank3]
    .sort((a, b) => a - b)
    .join("-");
  const payout = result.payout_trio || result.payout_trifecta || 0;
  const boatStrengths = turnPred.boatStrengths || [];

  // Strategy 1
  if (patterns[0]?.secondPlace && patterns[0]?.thirdPlace) {
    const { winnerCourse, secondPlace, thirdPlace } = patterns[0];
    const top2nd = Object.entries(secondPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([b]) => parseInt(b));
    const top3rd = Object.entries(thirdPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([b]) => parseInt(b));
    const combs = [];
    for (const b2 of top2nd) {
      for (const b3 of top3rd) {
        if (b2 !== winnerCourse && b3 !== winnerCourse && b3 !== b2) {
          combs.push([winnerCourse, b2, b3].sort().join("-"));
        }
      }
    }
    if (combs.length > 0) {
      results.strategies.patternTop3.purchased += combs.length;
      if (combs.includes(trifectaKey)) {
        results.strategies.patternTop3.hits++;
        results.strategies.patternTop3.payouts += payout;
      }
    }
  }

  // Strategy 2
  if (patterns[0]?.secondPlace && patterns[0]?.thirdPlace) {
    const { winnerCourse, secondPlace, thirdPlace } = patterns[0];
    const top2nd = Object.entries(secondPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([b]) => parseInt(b));
    const top3rd = Object.entries(thirdPlace)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([b]) => parseInt(b));
    const combs = [];
    for (const b2 of top2nd) {
      for (const b3 of top3rd) {
        if (b2 !== winnerCourse && b3 !== winnerCourse && b3 !== b2) {
          combs.push([winnerCourse, b2, b3].sort().join("-"));
        }
      }
    }
    if (combs.length > 0) {
      results.strategies.patternTop2.purchased += combs.length;
      if (combs.includes(trifectaKey)) {
        results.strategies.patternTop2.hits++;
        results.strategies.patternTop2.payouts += payout;
      }
    }
  }

  // Strategy 3: boatStrength上位4艇
  if (boatStrengths.length === 6) {
    const top4 = boatStrengths
      .map((s, i) => ({ b: i + 1, s }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.b);
    const combs = [];
    for (let b1 = 1; b1 <= 6; b1++) {
      for (let b2 = 1; b2 <= 6; b2++) {
        for (let b3 = 1; b3 <= 6; b3++) {
          if (b1 !== b2 && b2 !== b3 && b1 !== b3 && top4.includes(b1)) {
            combs.push([b1, b2, b3].sort().join("-"));
          }
        }
      }
    }
    const uniqueCombs = [...new Set(combs)];
    if (uniqueCombs.length > 0) {
      results.strategies.boatStrengthFiltered.purchased += uniqueCombs.length;
      if (uniqueCombs.includes(trifectaKey)) {
        results.strategies.boatStrengthFiltered.hits++;
        results.strategies.boatStrengthFiltered.payouts += payout;
      }
    }
  }

  // Strategy 4
  if (
    patterns[0]?.secondPlace &&
    patterns[0]?.thirdPlace &&
    boatStrengths.length === 6
  ) {
    const { winnerCourse, secondPlace, thirdPlace } = patterns[0];
    const top4 = boatStrengths
      .map((s, i) => ({ b: i + 1, s }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.b);
    const top2nd = Object.entries(secondPlace)
      .filter(([b]) => top4.includes(parseInt(b)))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([b]) => parseInt(b));
    const top3rd = Object.entries(thirdPlace)
      .filter(([b]) => top4.includes(parseInt(b)))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([b]) => parseInt(b));
    const combs = [];
    for (const b2 of top2nd) {
      for (const b3 of top3rd) {
        if (b2 !== winnerCourse && b3 !== winnerCourse && b3 !== b2) {
          combs.push([winnerCourse, b2, b3].sort().join("-"));
        }
      }
    }
    if (combs.length > 0) {
      results.strategies.patternWithStrengthFilter.purchased += combs.length;
      if (combs.includes(trifectaKey)) {
        results.strategies.patternWithStrengthFilter.hits++;
        results.strategies.patternWithStrengthFilter.payouts += payout;
      }
    }
  }
});

console.log(`分析結果 (${analyzed}レース)`);
console.log(`========================================\n`);

const strategies = [
  {
    key: "patternTop3",
    name: "Strategy 1: パターン最高確度+上位3艇組み合わせ",
  },
  {
    key: "patternTop2",
    name: "Strategy 2: パターン最高確度+上位2艇組み合わせ",
  },
  {
    key: "boatStrengthFiltered",
    name: "Strategy 3: 艇強度フィルタ（上位4艇）",
  },
  {
    key: "patternWithStrengthFilter",
    name: "Strategy 4: パターン+艇強度フィルタ統合",
  },
];

strategies.forEach(({ key, name }) => {
  const s = results.strategies[key];
  const hitRate =
    s.purchased > 0 ? ((s.hits / s.purchased) * 100).toFixed(1) : "0.0";
  const recoveryRate =
    s.purchased > 0
      ? ((s.payouts / (100 * s.purchased)) * 100).toFixed(1)
      : "0.0";

  console.log(`${name}`);
  console.log(`  購入数: ${s.purchased}, 的中: ${s.hits}`);
  console.log(`  的中率: ${hitRate}%, 回収率: ${recoveryRate}%\n`);
});

console.log(`========================================\n`);

const outputFile = `data/analysis/correct-turn-pattern-analysis.json`;
await fs.writeFile(
  outputFile,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      period: `${startDateStr} ～ ${endDateStr}`,
      analyzedRaces: analyzed,
      strategies: results.strategies,
    },
    null,
    2,
  ),
);

console.log(`結果を ${outputFile} に保存しました\n`);
