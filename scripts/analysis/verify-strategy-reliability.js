/**
 * 戦略の信頼性検証スクリプト
 * 
 * 大穴的中の影響を排除し、実際の再現性を検証します。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * 単勝の配当（外れなら偽値）
 */
function settleWin(prediction, result) {
  if (prediction.topPick !== result.rank1) return 0;
  return result.payouts.win[String(result.rank1)];
}

/**
 * 複勝の配当（外れなら偽値）
 */
function settlePlace(prediction, result) {
  const topPick = prediction.topPick;
  if (topPick !== result.rank1 && topPick !== result.rank2) return 0;
  return result.payouts.place[String(topPick)];
}

/**
 * 3連複の配当（外れなら偽値）
 */
function settleTrifecta(prediction, result) {
  const payoutsData = result.payouts;
  const sortedTop3 = [...prediction.top3].sort((a, b) => a - b);
  const sortedResult = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b);

  if (JSON.stringify(sortedTop3) !== JSON.stringify(sortedResult)) return 0;
  const payoutKeys = Object.keys(payoutsData.trifecta);
  for (const key of payoutKeys) {
    const numbers = key.split(/[-=]/).map(Number).sort((a, b) => a - b);
    if (JSON.stringify(numbers) === JSON.stringify(sortedResult)) {
      const payout = payoutsData.trifecta[key];
      if (payout) return payout;
    }
  }
  return 0;
}

/**
 * 3連単の配当（外れなら偽値）
 */
function settleTrio(prediction, result) {
  const predictedOrder = prediction.top3.join('-');
  const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;

  if (predictedOrder !== resultOrder) return 0;
  return result.payouts.trio[resultOrder];
}

const SETTLERS = {
  win: settleWin,
  place: settlePlace,
  trifecta: settleTrifecta,
  trio: settleTrio
};

/**
 * 1レース分の賭けを精算（配当。外れ・未知の賭け式は偽値）
 */
function settleBet(betType, prediction, result) {
  const settle = SETTLERS[betType];
  return settle ? settle(prediction, result) : 0;
}

/**
 * 配当の統計を計算
 */
function summarizePayouts(payouts, hitCount, totalPayout, totalInvestment) {
  // 統計を計算
  const recoveryRate = totalInvestment > 0 ? totalPayout / totalInvestment : 0;
  const hitRate = totalInvestment > 0 ? hitCount / (totalInvestment / 100) : 0;
  
  // 配当の統計
  payouts.sort((a, b) => a - b);
  const avgPayout = hitCount > 0 ? payouts.reduce((a, b) => a + b, 0) / hitCount : 0;
  const medianPayout = hitCount > 0 ? payouts[Math.floor(hitCount / 2)] : 0;
  const q25Payout = hitCount > 0 ? payouts[Math.floor(hitCount * 0.25)] : 0;
  const q75Payout = hitCount > 0 ? payouts[Math.floor(hitCount * 0.75)] : 0;
  const maxPayout = hitCount > 0 ? payouts[payouts.length - 1] : 0;
  const minPayout = hitCount > 0 ? payouts[0] : 0;
  
  // 外れ値の影響を計算（最大配当を除外した場合）
  const payoutsWithoutMax = payouts.slice(0, -1);
  const avgPayoutWithoutMax = payoutsWithoutMax.length > 0 
    ? payoutsWithoutMax.reduce((a, b) => a + b, 0) / payoutsWithoutMax.length 
    : 0;
  const recoveryRateWithoutMax = payoutsWithoutMax.length > 0
    ? (totalPayout - maxPayout * 100) / (totalInvestment - 100)
    : 0;

  return {
    recoveryRate,
    hitRate,
    avgPayout,
    medianPayout,
    q25Payout,
    q75Payout,
    maxPayout,
    minPayout,
    avgPayoutWithoutMax,
    recoveryRateWithoutMax
  };
}

/**
 * 日別の集計を日付順の配列にする
 */
function toDailyRecoveries(dailyResults) {
  return Object.entries(dailyResults)
    .map(([date, data]) => ({
      date,
      recoveryRate: data.investment > 0 ? data.payout / data.investment : 0,
      races: data.investment / 100,
      hits: data.hits
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 回収率を計算（詳細版）
 */
function calculateRecoveryDetailed(races, betType, conditionFn) {
  let totalInvestment = 0;
  let totalPayout = 0;
  let hitCount = 0;
  const payouts = [];
  const dailyResults = {}; // 日別の結果

  for (const race of races) {
    if (!conditionFn(race)) continue;

    const date = race.date;
    if (!dailyResults[date]) {
      dailyResults[date] = { investment: 0, payout: 0, hits: 0 };
    }

    totalInvestment += 100;
    dailyResults[date].investment += 100;
    
    const payout = settleBet(betType, race.prediction, race.result);

    if (payout) {
      totalPayout += payout;
      hitCount++;
      const payoutMultiplier = payout / 100;
      payouts.push(payoutMultiplier);
      dailyResults[date].payout += payout;
      dailyResults[date].hits++;
    }
  }

  const stats = summarizePayouts(payouts, hitCount, totalPayout, totalInvestment);
  const dailyRecoveries = toDailyRecoveries(dailyResults);

  return {
    totalInvestment,
    totalPayout,
    hitCount,
    ...stats,
    sampleSize: totalInvestment / 100,
    payouts,
    dailyRecoveries
  };
}

/**
 * 検証対象の戦略
 */
function buildStrategies() {
  return [
    {
      name: '芦屋 - 3連複',
      condition: (race) => race.venueCode === 21,
      betType: 'trifecta'
    },
    {
      name: 'A1級2名以上 - 3連単',
      condition: (race) => {
        const players = race.prediction.players;
        return players.filter(p => p.grade === 'A1').length >= 2;
      },
      betType: 'trio'
    },
    {
      name: '多摩川 - 複勝',
      condition: (race) => race.venueCode === 5,
      betType: 'place'
    }
  ];
}

/**
 * 基本統計を表示
 */
function printBasicStats(result) {
  console.log(`基本統計:`);
  console.log(`  サンプル数: ${result.sampleSize}レース`);
  console.log(`  的中数: ${result.hitCount}回`);
  console.log(`  的中率: ${(result.hitRate * 100).toFixed(2)}%`);
  console.log(`  総投資額: ${result.totalInvestment}円`);
  console.log(`  総回収額: ${result.totalPayout}円`);
  console.log(`  回収率: ${(result.recoveryRate * 100).toFixed(2)}%\n`);
}

/**
 * 配当の分布を表示
 */
function printPayoutDistribution(result) {
  console.log(`配当の分布:`);
  console.log(`  平均配当: ${result.avgPayout.toFixed(2)}倍`);
  console.log(`  中央値（メディアン）: ${result.medianPayout.toFixed(2)}倍`);
  console.log(`  25%タイル: ${result.q25Payout.toFixed(2)}倍`);
  console.log(`  75%タイル: ${result.q75Payout.toFixed(2)}倍`);
  console.log(`  最小配当: ${result.minPayout.toFixed(2)}倍`);
  console.log(`  最大配当: ${result.maxPayout.toFixed(2)}倍\n`);
}

/**
 * 外れ値の影響を表示（平均/中央値の比を返す）
 */
function printOutlierImpact(result) {
  // 平均と中央値の差を確認
  const avgMedianDiff = result.avgPayout - result.medianPayout;
  const avgMedianRatio = result.medianPayout > 0 ? result.avgPayout / result.medianPayout : 0;

  console.log(`外れ値の影響:`);
  console.log(`  平均 - 中央値: ${avgMedianDiff.toFixed(2)}倍`);
  console.log(`  平均/中央値の比: ${avgMedianRatio.toFixed(2)}倍`);

  if (avgMedianRatio > 2.0) {
    console.log(`  ⚠️  警告: 平均が中央値の2倍以上。大穴的中の影響が大きい可能性があります。`);
  } else if (avgMedianRatio > 1.5) {
    console.log(`  ⚠️  注意: 平均が中央値の1.5倍以上。外れ値の影響がある可能性があります。`);
  } else {
    console.log(`  ✅ 平均と中央値の差は許容範囲内です。`);
  }
  return avgMedianRatio;
}

/**
 * 最大配当を除外した場合を表示
 */
function printWithoutMax(result) {
  // 最大配当を除外した場合の回収率
  console.log(`\n最大配当を除外した場合:`);
  console.log(`  平均配当: ${result.avgPayoutWithoutMax.toFixed(2)}倍`);
  console.log(`  回収率: ${(result.recoveryRateWithoutMax * 100).toFixed(2)}%`);

  if (result.recoveryRateWithoutMax < 1.0) {
    console.log(`  ❌ 最大配当を除外すると回収率が100%未満になります。`);
    console.log(`  → この戦略は大穴的中に依存している可能性が高いです。`);
  } else if (result.recoveryRateWithoutMax < result.recoveryRate * 0.8) {
    console.log(`  ⚠️  最大配当を除外すると回収率が${((1 - result.recoveryRateWithoutMax / result.recoveryRate) * 100).toFixed(1)}%低下します。`);
    console.log(`  → 外れ値の影響が大きいですが、それでも回収率100%超を維持しています。`);
  } else {
    console.log(`  ✅ 最大配当を除外しても回収率100%超を維持しています。`);
  }
}

/**
 * 日別の変動を表示（変動係数と100%超の日の割合を返す）
 */
function printDailyVariation(result) {
  // 日別の回収率の変動
  console.log(`\n日別の回収率の変動:`);
  const dailyRecoveries = result.dailyRecoveries.map(d => d.recoveryRate);
  const avgDailyRecovery = dailyRecoveries.reduce((a, b) => a + b, 0) / dailyRecoveries.length;
  const variance = dailyRecoveries.reduce((sum, r) => sum + Math.pow(r - avgDailyRecovery, 2), 0) / dailyRecoveries.length;
  const stdDev = Math.sqrt(variance);
  const cv = avgDailyRecovery > 0 ? stdDev / avgDailyRecovery : 0; // 変動係数

  console.log(`  平均日次回収率: ${(avgDailyRecovery * 100).toFixed(2)}%`);
  console.log(`  標準偏差: ${(stdDev * 100).toFixed(2)}%`);
  console.log(`  変動係数: ${(cv * 100).toFixed(2)}%`);

  const profitableDays = dailyRecoveries.filter(r => r > 1.0).length;
  const profitableRate = dailyRecoveries.length > 0 ? profitableDays / dailyRecoveries.length : 0;
  console.log(`  回収率100%超の日数: ${profitableDays}/${dailyRecoveries.length}日 (${(profitableRate * 100).toFixed(1)}%)`);

  if (cv > 1.0) {
    console.log(`  ⚠️  変動係数が100%を超えています。日次変動が非常に大きいです。`);
  } else if (cv > 0.5) {
    console.log(`  ⚠️  変動係数が50%を超えています。日次変動が大きいです。`);
  } else {
    console.log(`  ✅ 変動係数は許容範囲内です。日次変動は比較的安定しています。`);
  }

  if (profitableRate < 0.5) {
    console.log(`  ⚠️  回収率100%超の日数が50%未満です。日次での再現性が低い可能性があります。`);
  } else {
    console.log(`  ✅ 回収率100%超の日数が50%以上です。日次での再現性があります。`);
  }
  return { cv, profitableRate };
}

/**
 * 時系列での傾向を表示
 */
function printTrend(result) {
  // 時系列での傾向
  console.log(`\n時系列での傾向:`);
  const firstHalf = result.dailyRecoveries.slice(0, Math.floor(result.dailyRecoveries.length / 2));
  const secondHalf = result.dailyRecoveries.slice(Math.floor(result.dailyRecoveries.length / 2));

  const firstHalfRecovery = firstHalf.length > 0
    ? firstHalf.reduce((sum, d) => sum + d.recoveryRate * d.races, 0) / firstHalf.reduce((sum, d) => sum + d.races, 0)
    : 0;
  const secondHalfRecovery = secondHalf.length > 0
    ? secondHalf.reduce((sum, d) => sum + d.recoveryRate * d.races, 0) / secondHalf.reduce((sum, d) => sum + d.races, 0)
    : 0;

  console.log(`  前半期間の回収率: ${(firstHalfRecovery * 100).toFixed(2)}%`);
  console.log(`  後半期間の回収率: ${(secondHalfRecovery * 100).toFixed(2)}%`);

  if (secondHalfRecovery < firstHalfRecovery * 0.7) {
    console.log(`  ⚠️  後半期間の回収率が前半の70%未満です。パフォーマンスが低下している可能性があります。`);
  } else if (secondHalfRecovery > firstHalfRecovery * 1.3) {
    console.log(`  ⚠️  後半期間の回収率が前半の130%を超えています。一時的な好調の可能性があります。`);
  } else {
    console.log(`  ✅ 前半と後半の回収率に大きな差はありません。安定性があります。`);
  }
}

/**
 * 最終判定を表示
 */
function printFinalVerdict(result, avgMedianRatio, profitableRate, cv) {
  // 最終判定
  console.log(`\n【最終判定】`);
  let reliable = true;
  let reasons = [];

  if (avgMedianRatio > 2.0) {
    reliable = false;
    reasons.push('平均配当が中央値の2倍以上（大穴依存）');
  }
  if (result.recoveryRateWithoutMax < 1.0) {
    reliable = false;
    reasons.push('最大配当を除外すると回収率100%未満');
  }
  if (profitableRate < 0.4) {
    reliable = false;
    reasons.push('回収率100%超の日数が40%未満');
  }
  if (cv > 1.0) {
    reasons.push('日次変動が非常に大きい');
  }

  if (reliable && reasons.length === 0) {
    console.log(`  ✅ この戦略は統計的に信頼できます。`);
    console.log(`     大穴依存ではなく、安定した回収率を維持しています。`);
  } else if (reliable) {
    console.log(`  ⚠️  この戦略は基本的に信頼できますが、以下の点に注意が必要です:`);
    reasons.forEach(r => console.log(`     - ${r}`));
  } else {
    console.log(`  ❌ この戦略は大穴依存の可能性が高いです。`);
    console.log(`     以下の理由により、再現性に疑問があります:`);
    reasons.forEach(r => console.log(`     - ${r}`));
  }
}

/**
 * 戦略の信頼性を検証
 */
async function verifyStrategyReliability() {
  console.log('=== 戦略の信頼性検証 ===\n');
  console.log('大穴的中の影響を排除し、実際の再現性を検証します...\n');

  const races = await loadData();
  console.log(`データ読み込み完了: ${races.length}レース\n`);

  for (const strategy of buildStrategies()) {
    console.log(`\n【${strategy.name}】\n`);

    const result = calculateRecoveryDetailed(races, strategy.betType, strategy.condition);

    if (result.sampleSize < 50) {
      console.log(`サンプル数が少ないため、検証をスキップします（${result.sampleSize}レース）\n`);
      continue;
    }

    printBasicStats(result);
    printPayoutDistribution(result);
    const avgMedianRatio = printOutlierImpact(result);
    printWithoutMax(result);
    const { cv, profitableRate } = printDailyVariation(result);
    printTrend(result);
    printFinalVerdict(result, avgMedianRatio, profitableRate, cv);
  }
}

// 実行
verifyStrategyReliability().catch(console.error);
