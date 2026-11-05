/**
 * 回収率100%超の戦略を探すスクリプト
 * 
 * 様々な条件の組み合わせで、回収率100%を超える戦略を探索します。
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
        if (race.result?.finished && race.prediction?.players && race.result?.payouts) {
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
 * 回収率を計算
 */
function calculateRecovery(races, betType, conditionFn) {
  let totalInvestment = 0;
  let totalPayout = 0;
  let hitCount = 0;
  const payouts = [];

  for (const race of races) {
    if (!conditionFn(race)) continue;

    totalInvestment += 100;
    const prediction = race.prediction;
    const result = race.result;
    const payoutsData = result.payouts;

    let hit = false;
    let payout = 0;

    if (betType === 'win') {
      // 単勝
      if (prediction.topPick === result.rank1) {
        payout = payoutsData.win[String(result.rank1)];
        if (payout) {
          hit = true;
        }
      }
    } else if (betType === 'place') {
      // 複勝（1着または2着）
      const topPick = prediction.topPick;
      if (topPick === result.rank1 || topPick === result.rank2) {
        payout = payoutsData.place[String(topPick)];
        if (payout) {
          hit = true;
        }
      }
    } else if (betType === 'trifecta') {
      // 3連複（順番問わず）
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
      // 3連単（順番通り）
      const predictedOrder = prediction.top3.join('-');
      const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;

      if (predictedOrder === resultOrder) {
        payout = payoutsData.trio[resultOrder];
        if (payout) {
          hit = true;
        }
      }
    }

    if (hit && payout) {
      totalPayout += payout;
      hitCount++;
      payouts.push(payout / 100); // 倍率として保存
    }
  }

  const recoveryRate = totalInvestment > 0 ? totalPayout / totalInvestment : 0;
  const hitRate = totalInvestment > 0 ? hitCount / (totalInvestment / 100) : 0;
  const avgPayout = hitCount > 0 ? payouts.reduce((a, b) => a + b, 0) / hitCount : 0;
  const medianPayout = hitCount > 0 ? payouts.sort((a, b) => a - b)[Math.floor(hitCount / 2)] : 0;

  return {
    totalInvestment,
    totalPayout,
    hitCount,
    recoveryRate,
    hitRate,
    avgPayout,
    medianPayout,
    sampleSize: totalInvestment / 100
  };
}

/**
 * 条件別の戦略を探索
 */
function findProfitableStrategies(races) {
  console.log('=== 回収率100%超の戦略を探索 ===\n');

  const strategies = [];

  // 1. 会場別 × 購入種別
  console.log('【会場別 × 購入種別】\n');
  const betTypes = ['win', 'place', 'trifecta', 'trio'];
  
  for (let venueCode = 1; venueCode <= 24; venueCode++) {
    for (const betType of betTypes) {
      const conditionFn = (race) => race.venueCode === venueCode;
      const result = calculateRecovery(races, betType, conditionFn);

      if (result.sampleSize >= 50 && result.recoveryRate > 1.0) {
        strategies.push({
          name: `${venueNames[venueCode]} - ${betType}`,
          condition: `会場: ${venueNames[venueCode]}`,
          betType,
          ...result
        });

        console.log(`${venueNames[venueCode]} - ${betType}:`);
        console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
        console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
        console.log(`  平均配当: ${result.avgPayout.toFixed(2)}倍`);
        console.log(`  サンプル数: ${result.sampleSize}レース\n`);
      }
    }
  }

  // 2. 級別構成 × 購入種別
  console.log('\n【級別構成 × 購入種別】\n');
  
  // A1級が2名以上
  const a1Count2Plus = (race) => {
    const players = race.prediction.players;
    return players.filter(p => p.grade === 'A1').length >= 2;
  };

  for (const betType of betTypes) {
    const result = calculateRecovery(races, betType, a1Count2Plus);
    if (result.sampleSize >= 100 && result.recoveryRate > 1.0) {
      strategies.push({
        name: `A1級2名以上 - ${betType}`,
        condition: 'A1級が2名以上',
        betType,
        ...result
      });
      console.log(`A1級2名以上 - ${betType}:`);
      console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
      console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
      console.log(`  サンプル数: ${result.sampleSize}レース\n`);
    }
  }

  // 3. 1号艇 × 級別 × 購入種別
  console.log('\n【1号艇 × 級別 × 購入種別】\n');
  
  const lane1A1 = (race) => {
    const players = race.prediction.players;
    const topPick = race.prediction.topPick;
    if (topPick !== 1) return false;
    const topPickPlayer = players.find(p => p.number === topPick);
    return topPickPlayer && topPickPlayer.grade === 'A1';
  };

  for (const betType of betTypes) {
    const result = calculateRecovery(races, betType, lane1A1);
    if (result.sampleSize >= 50 && result.recoveryRate > 1.0) {
      strategies.push({
        name: `1号艇A1級 - ${betType}`,
        condition: '1号艇がA1級',
        betType,
        ...result
      });
      console.log(`1号艇A1級 - ${betType}:`);
      console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
      console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
      console.log(`  サンプル数: ${result.sampleSize}レース\n`);
    }
  }

  // 4. 好モーター × 1号艇 × 購入種別
  console.log('\n【好モーター × 1号艇 × 購入種別】\n');
  
  const goodMotorLane1 = (race) => {
    const players = race.prediction.players;
    const topPick = race.prediction.topPick;
    if (topPick !== 1) return false;
    const topPickPlayer = players.find(p => p.number === topPick);
    return topPickPlayer && parseFloat(topPickPlayer.motor2Rate) >= 40;
  };

  for (const betType of betTypes) {
    const result = calculateRecovery(races, betType, goodMotorLane1);
    if (result.sampleSize >= 50 && result.recoveryRate > 1.0) {
      strategies.push({
        name: `好モーター×1号艇 - ${betType}`,
        condition: '1号艇かつモーター2連率40%以上',
        betType,
        ...result
      });
      console.log(`好モーター×1号艇 - ${betType}:`);
      console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
      console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
      console.log(`  サンプル数: ${result.sampleSize}レース\n`);
    }
  }

  // 5. 複勝（1号艇）の条件別分析
  console.log('\n【1号艇複勝の条件別分析】\n');
  
  const lane1PlaceConditions = [
    {
      name: '1号艇複勝（全条件）',
      condition: (race) => race.prediction.topPick === 1
    },
    {
      name: '1号艇複勝（A1級）',
      condition: (race) => {
        if (race.prediction.topPick !== 1) return false;
        const players = race.prediction.players;
        const topPickPlayer = players.find(p => p.number === 1);
        return topPickPlayer && topPickPlayer.grade === 'A1';
      }
    },
    {
      name: '1号艇複勝（A2級以上）',
      condition: (race) => {
        if (race.prediction.topPick !== 1) return false;
        const players = race.prediction.players;
        const topPickPlayer = players.find(p => p.number === 1);
        return topPickPlayer && (topPickPlayer.grade === 'A1' || topPickPlayer.grade === 'A2');
      }
    },
    {
      name: '1号艇複勝（好モーター40%以上）',
      condition: (race) => {
        if (race.prediction.topPick !== 1) return false;
        const players = race.prediction.players;
        const topPickPlayer = players.find(p => p.number === 1);
        return topPickPlayer && parseFloat(topPickPlayer.motor2Rate) >= 40;
      }
    }
  ];

  for (const cond of lane1PlaceConditions) {
    const result = calculateRecovery(races, 'place', cond.condition);
    if (result.sampleSize >= 50) {
      strategies.push({
        name: cond.name,
        condition: cond.name,
        betType: 'place',
        ...result
      });
      console.log(`${cond.name}:`);
      console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
      console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
      console.log(`  平均配当: ${result.avgPayout.toFixed(2)}倍`);
      console.log(`  サンプル数: ${result.sampleSize}レース`);
      if (result.recoveryRate > 1.0) {
        console.log(`  ✅ 回収率100%超！\n`);
      } else {
        console.log(`  ❌ 回収率100%未満\n`);
      }
    }
  }

  // 6. 会場 × 1号艇複勝
  console.log('\n【会場別 × 1号艇複勝】\n');
  for (let venueCode = 1; venueCode <= 24; venueCode++) {
    const conditionFn = (race) => 
      race.venueCode === venueCode && race.prediction.topPick === 1;
    const result = calculateRecovery(races, 'place', conditionFn);

    if (result.sampleSize >= 30 && result.recoveryRate > 1.0) {
      strategies.push({
        name: `${venueNames[venueCode]} - 1号艇複勝`,
        condition: `会場: ${venueNames[venueCode]}, 1号艇本命`,
        betType: 'place',
        ...result
      });
      console.log(`${venueNames[venueCode]} - 1号艇複勝:`);
      console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%`);
      console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
      console.log(`  サンプル数: ${result.sampleSize}レース\n`);
    }
  }

  // 戦略を回収率順にソート
  strategies.sort((a, b) => b.recoveryRate - a.recoveryRate);

  return strategies;
}

/**
 * 統計的信頼度を計算
 */
function calculateConfidenceInterval(hitRate, sampleSize, confidence = 0.95) {
  const z = confidence === 0.95 ? 1.96 : 2.576;
  const se = Math.sqrt(hitRate * (1 - hitRate) / sampleSize);
  const margin = z * se;
  return {
    lower: Math.max(0, hitRate - margin),
    upper: Math.min(1, hitRate + margin),
    margin
  };
}

/**
 * メイン実行関数
 */
async function main() {
  console.log('=== 回収率100%超の戦略探索 ===\n');
  console.log('データを読み込んでいます...\n');

  const races = await loadData();
  console.log(`読み込み完了: ${races.length}レース\n`);

  const strategies = findProfitableStrategies(races);

  // 結果をまとめる
  const profitableStrategies = strategies.filter(s => s.recoveryRate > 1.0);
  const highConfidenceStrategies = profitableStrategies.filter(s => 
    s.sampleSize >= 100
  );

  console.log('\n=== 結果サマリー ===\n');
  console.log(`回収率100%超の戦略数: ${profitableStrategies.length}個\n`);
  console.log(`高信頼度戦略（サンプル数100以上）: ${highConfidenceStrategies.length}個\n`);

  if (highConfidenceStrategies.length > 0) {
    console.log('【高信頼度戦略トップ10】\n');
    highConfidenceStrategies.slice(0, 10).forEach((s, idx) => {
      const ci = calculateConfidenceInterval(s.hitRate, s.sampleSize);
      const expectedRecoveryLower = ci.lower * s.avgPayout;
      const expectedRecoveryUpper = ci.upper * s.avgPayout;

      console.log(`${idx + 1}. ${s.name}`);
      console.log(`   条件: ${s.condition}`);
      console.log(`   購入種別: ${s.betType}`);
      console.log(`   回収率: ${(s.recoveryRate * 100).toFixed(2)}%`);
      console.log(`   的中率: ${(s.hitRate * 100).toFixed(2)}% (95%信頼区間: ${(ci.lower * 100).toFixed(2)}% - ${(ci.upper * 100).toFixed(2)}%)`);
      console.log(`   平均配当: ${s.avgPayout.toFixed(2)}倍`);
      console.log(`   期待回収率（信頼区間）: ${(expectedRecoveryLower * 100).toFixed(2)}% - ${(expectedRecoveryUpper * 100).toFixed(2)}%`);
      console.log(`   サンプル数: ${s.sampleSize}レース`);
      
      if (expectedRecoveryLower > 1.0) {
        console.log(`   ✅ 95%信頼区間でも回収率100%超！\n`);
      } else if (s.recoveryRate > 1.0) {
        console.log(`   ⚠️  回収率100%超だが、信頼区間は要検討\n`);
      } else {
        console.log(`   ❌ 回収率100%未満\n`);
      }
    });
  }

  // 結果をJSONファイルに保存
  const output = {
    generatedAt: new Date().toISOString(),
    totalRaces: races.length,
    profitableStrategies: profitableStrategies.map(s => ({
      name: s.name,
      condition: s.condition,
      betType: s.betType,
      recoveryRate: s.recoveryRate,
      hitRate: s.hitRate,
      avgPayout: s.avgPayout,
      medianPayout: s.medianPayout,
      sampleSize: s.sampleSize
    })),
    highConfidenceStrategies: highConfidenceStrategies.map(s => ({
      name: s.name,
      condition: s.condition,
      betType: s.betType,
      recoveryRate: s.recoveryRate,
      hitRate: s.hitRate,
      avgPayout: s.avgPayout,
      sampleSize: s.sampleSize
    }))
  };

  const outputPath = path.join(__dirname, '..', 'data', 'profitable-strategies.json');
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n結果を保存しました: ${outputPath}\n`);
}

// 実行
main().catch(console.error);



