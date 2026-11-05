/**
 * 期待値ベースで回収率100%超を目指す戦略分析
 * 
 * 条件別の期待値を計算し、期待値が100%超える条件のみ購入する戦略を設計します。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 会場名マッピング
const venueNames = {
  1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
  7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
  13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
  19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
};

/**
 * データ読み込み
 */
async function loadData() {
  const predictionsDir = path.join(__dirname, '..', 'data', 'predictions');
  const files = await fs.readdir(predictionsDir);
  const predictionFiles = files
    .filter(f => f.endsWith('.json') && f !== 'summary.json')
    .sort();

  const allRaces = [];
  
  for (const file of predictionFiles) {
    try {
      const filePath = path.join(predictionsDir, file);
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      
      for (const race of data.races) {
        if (race.result?.finished && race.result?.payouts) {
          allRaces.push({
            ...race,
            date: data.date
          });
        }
      }
    } catch {
      // スキップ
    }
  }

  return allRaces;
}

/**
 * 選手データを取得
 */
function getPlayers(race) {
  return race.prediction?.players || 
         race.predictions?.standard?.players ||
         race.predictions?.safeBet?.players ||
         race.predictions?.upsetFocus?.players ||
         [];
}

/**
 * 期待値を計算（詳細版）
 */
function calculateExpectedValue(races, getPredictionFn, betType, conditionFn = null) {
  let totalInvestment = 0;
  let hitCount = 0;
  const payouts = [];

  for (const race of races) {
    if (conditionFn && !conditionFn(race)) continue;

    const prediction = getPredictionFn(race);
    if (!prediction) continue;

    totalInvestment += 100;
    const result = race.result;
    const payoutsData = result.payouts;

    let hit = false;
    let payout = 0;

    if (betType === 'win') {
      if (prediction.topPick === result.rank1) {
        payout = payoutsData.win[String(result.rank1)];
        if (payout) hit = true;
      }
    } else if (betType === 'place') {
      const topPick = prediction.topPick;
      if (topPick === result.rank1 || topPick === result.rank2) {
        payout = payoutsData.place[String(topPick)];
        if (payout) hit = true;
      }
    } else if (betType === 'trifecta') {
      const sortedTop3 = [...prediction.top3].sort((a, b) => a - b);
      const sortedResult = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b);
      if (JSON.stringify(sortedTop3) === JSON.stringify(sortedResult)) {
        const payoutKeys = Object.keys(payoutsData.trifecta);
        for (const key of payoutKeys) {
          const numbers = key.split(/[-=]/).map(Number).sort((a, b) => a - b);
          if (JSON.stringify(numbers) === JSON.stringify(sortedResult)) {
            payout = payoutsData.trifecta[key];
            if (payout) {
              hit = true;
              break;
            }
          }
        }
      }
    } else if (betType === 'trio') {
      const predictedOrder = prediction.top3.join('-');
      const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;
      if (predictedOrder === resultOrder) {
        payout = payoutsData.trio[resultOrder];
        if (payout) hit = true;
      }
    }

    if (hit && payout) {
      hitCount++;
      payouts.push(payout / 100);
    }
  }

  if (payouts.length === 0) {
    return {
      sampleSize: totalInvestment / 100,
      hitRate: 0,
      avgPayout: 0,
      medianPayout: 0,
      expectedValue: 0,
      expectedValueMedian: 0
    };
  }

  payouts.sort((a, b) => a - b);
  const hitRate = hitCount / (totalInvestment / 100);
  const avgPayout = payouts.reduce((a, b) => a + b, 0) / payouts.length;
  const medianPayout = payouts[Math.floor(payouts.length / 2)];
  
  // 期待値（平均ベース）
  const expectedValue = hitRate * avgPayout;
  
  // 期待値（中央値ベース）
  const expectedValueMedian = hitRate * medianPayout;

  return {
    sampleSize: totalInvestment / 100,
    hitRate,
    avgPayout,
    medianPayout,
    expectedValue,
    expectedValueMedian,
    payouts
  };
}

/**
 * 信頼区間の計算
 */
function calculateConfidenceInterval(hitRate, sampleSize, confidence = 0.95) {
  const z = confidence === 0.95 ? 1.96 : 2.576;
  const se = Math.sqrt(hitRate * (1 - hitRate) / sampleSize);
  const margin = z * se;
  return {
    lower: Math.max(0, hitRate - margin),
    upper: Math.min(1, hitRate + margin)
  };
}

/**
 * 期待値ベースの戦略分析
 */
async function analyzeExpectedValueStrategies(races) {
  console.log('=== 期待値ベースの戦略分析 ===\n');
  console.log('条件別の期待値を計算し、期待値が100%超える条件のみ購入する戦略を設計します...\n');

  const models = ['standard', 'safeBet', 'upsetFocus'];
  const betTypes = ['place', 'trifecta'];
  const strategies = [];

  // 条件の定義
  const conditions = [
    {
      name: '全条件',
      fn: () => true
    },
    {
      name: '1号艇がA1級',
      fn: (race) => {
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && lane1.grade === 'A1';
      }
    },
    {
      name: '1号艇がA2級以上',
      fn: (race) => {
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && (lane1.grade === 'A1' || lane1.grade === 'A2');
      }
    },
    {
      name: '1号艇のモーター2連率40%以上',
      fn: (race) => {
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && parseFloat(lane1.motor2Rate) >= 40;
      }
    },
    {
      name: '1号艇のモーター2連率35%以上',
      fn: (race) => {
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && parseFloat(lane1.motor2Rate) >= 35;
      }
    },
    {
      name: 'A1級2名以上',
      fn: (race) => {
        const players = getPlayers(race);
        return players.filter(p => p.grade === 'A1').length >= 2;
      }
    },
    {
      name: 'A1級1名以上',
      fn: (race) => {
        const players = getPlayers(race);
        return players.filter(p => p.grade === 'A1').length >= 1;
      }
    },
    {
      name: '1号艇がA1級 かつ モーター2連率40%以上',
      fn: (race) => {
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && lane1.grade === 'A1' && parseFloat(lane1.motor2Rate) >= 40;
      }
    }
  ];

  // 会場別の条件も追加
  for (let venueCode = 1; venueCode <= 24; venueCode++) {
    conditions.push({
      name: `会場: ${venueNames[venueCode]}`,
      fn: (race) => race.venueCode === venueCode
    });
    
    conditions.push({
      name: `会場: ${venueNames[venueCode]} かつ 1号艇がA1級`,
      fn: (race) => {
        if (race.venueCode !== venueCode) return false;
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && lane1.grade === 'A1';
      }
    });
    
    conditions.push({
      name: `会場: ${venueNames[venueCode]} かつ 1号艇のモーター2連率40%以上`,
      fn: (race) => {
        if (race.venueCode !== venueCode) return false;
        const players = getPlayers(race);
        const lane1 = players.find(p => p.number === 1);
        return lane1 && parseFloat(lane1.motor2Rate) >= 40;
      }
    });
  }

  for (const condition of conditions) {
    for (const modelKey of models) {
      for (const betType of betTypes) {
        const getPredictionFn = (race) => {
          if (race.predictions && race.predictions[modelKey]) {
            return race.predictions[modelKey];
          }
          if (modelKey === 'standard' && race.prediction) {
            return race.prediction;
          }
          return null;
        };

        const result = calculateExpectedValue(races, getPredictionFn, betType, condition.fn);

        // サンプル数が十分で、期待値（平均ベース）が100%超の場合
        if (result.sampleSize >= 50 && result.expectedValue > 1.0) {
          const ci = calculateConfidenceInterval(result.hitRate, result.sampleSize);
          const expectedValueLower = ci.lower * result.avgPayout;
          const expectedValueUpper = ci.upper * result.avgPayout;

          strategies.push({
            condition: condition.name,
            model: modelKey,
            betType,
            hitRate: result.hitRate,
            avgPayout: result.avgPayout,
            medianPayout: result.medianPayout,
            expectedValue: result.expectedValue,
            expectedValueMedian: result.expectedValueMedian,
            expectedValueLower,
            expectedValueUpper,
            ci,
            sampleSize: result.sampleSize
          });
        }
      }
    }
  }

  // 期待値（信頼区間下限）でソート
  strategies.sort((a, b) => b.expectedValueLower - a.expectedValueLower);

  return strategies;
}

/**
 * 選択的購入戦略のシミュレーション
 */
function simulateSelectiveBetting(races, strategies) {
  console.log('\n=== 選択的購入戦略のシミュレーション ===\n');
  console.log('期待値が100%超える条件のみ購入する戦略をシミュレーションします...\n');

  // 高信頼度戦略（信頼区間下限でも100%超）をフィルタリング
  const highConfidenceStrategies = strategies.filter(s => s.expectedValueLower > 1.0 && s.sampleSize >= 100);
  
  if (highConfidenceStrategies.length === 0) {
    console.log('信頼区間下限でも100%超える戦略は見つかりませんでした。\n');
    console.log('期待値が100%超える戦略（信頼区間は要検討）を分析します...\n');
    
    const promisingStrategies = strategies.filter(s => s.expectedValue > 1.0 && s.sampleSize >= 100);
    
    if (promisingStrategies.length > 0) {
      console.log(`期待値100%超の戦略: ${promisingStrategies.length}個\n`);
      
      promisingStrategies.slice(0, 10).forEach((s, idx) => {
        console.log(`${idx + 1}. ${s.condition}`);
        console.log(`   モデル: ${s.model} - ${s.betType}`);
        console.log(`   期待値: ${(s.expectedValue * 100).toFixed(2)}%`);
        console.log(`   期待値（信頼区間下限）: ${(s.expectedValueLower * 100).toFixed(2)}%`);
        console.log(`   的中率: ${(s.hitRate * 100).toFixed(2)}%`);
        console.log(`   平均配当: ${s.avgPayout.toFixed(2)}倍`);
        console.log(`   中央値配当: ${s.medianPayout.toFixed(2)}倍`);
        console.log(`   期待値（中央値ベース）: ${(s.expectedValueMedian * 100).toFixed(2)}%`);
        console.log(`   サンプル数: ${s.sampleSize}レース\n`);
      });
    }
    
    return promisingStrategies;
  }

  console.log(`高信頼度戦略: ${highConfidenceStrategies.length}個\n`);
  
  highConfidenceStrategies.slice(0, 10).forEach((s, idx) => {
    console.log(`${idx + 1}. ${s.condition}`);
    console.log(`   モデル: ${s.model} - ${s.betType}`);
    console.log(`   期待値: ${(s.expectedValue * 100).toFixed(2)}%`);
    console.log(`   期待値（信頼区間下限）: ${(s.expectedValueLower * 100).toFixed(2)}%`);
    console.log(`   的中率: ${(s.hitRate * 100).toFixed(2)}%`);
    console.log(`   平均配当: ${s.avgPayout.toFixed(2)}倍`);
    console.log(`   中央値配当: ${s.medianPayout.toFixed(2)}倍`);
    console.log(`   期待値（中央値ベース）: ${(s.expectedValueMedian * 100).toFixed(2)}%`);
    console.log(`   サンプル数: ${s.sampleSize}レース\n`);
  });

  return highConfidenceStrategies;
}

/**
 * メイン実行関数
 */
async function main() {
  console.log('=== 期待値ベースで回収率100%超を目指す戦略分析 ===\n');

  const races = await loadData();
  console.log(`データ読み込み完了: ${races.length}レース\n`);

  const strategies = await analyzeExpectedValueStrategies(races);
  
  console.log(`\n=== 結果サマリー ===\n`);
  console.log(`期待値100%超の戦略数: ${strategies.length}個\n`);

  const highConfidenceStrategies = simulateSelectiveBetting(races, strategies);

  // 結果をJSONファイルに保存
  const output = {
    generatedAt: new Date().toISOString(),
    totalRaces: races.length,
    allStrategies: strategies,
    highConfidenceStrategies
  };

  const outputPath = path.join(__dirname, '..', 'data', 'expected-value-strategies.json');
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n結果を保存しました: ${outputPath}\n`);
}

// 実行
main().catch(console.error);


