const fs = require('fs');
const path = require('path');

// 全ての予測ファイルを読み込む
function loadAllPredictions() {
  const predictionsDir = path.join(__dirname, '../../data/predictions');
  const files = fs.readdirSync(predictionsDir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/))
    .sort();

  const allRaces = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(predictionsDir, file), 'utf8'));
      if (data.races) {
        allRaces.push(...data.races.map(r => ({ ...r, date: data.date || file.replace('.json', '') })));
      }
    } catch (error) {
      console.error(`Error loading ${file}:`, error.message);
    }
  }

  return allRaces;
}

// 3モデル全てがあるレースのみをフィルタ
function filterThreeModelsRaces(races) {
  return races.filter(race =>
    race.predictions &&
    race.predictions.standard &&
    race.predictions.safeBet &&
    race.predictions.upsetFocus &&
    race.result &&
    race.result.finished
  );
}

// 配列が完全に一致するかチェック
function arraysEqual(arr1, arr2) {
  if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
  return arr1.every((val, index) => val === arr2[index]);
}

// 配当取得関数
function getWinPayout(result, boatNumber) {
  if (!result || !result.payouts || !result.payouts.win) return 0;
  return result.payouts.win[boatNumber] || 0;
}

function getPlacePayout(result, boatNumber) {
  if (!result || !result.payouts || !result.payouts.place) return 0;
  return result.payouts.place[boatNumber] || 0;
}

function getTrifectaPayout(result) {
  if (!result || !result.payouts || !result.payouts.trifecta) return 0;
  const payouts = Object.values(result.payouts.trifecta);
  return payouts.length > 0 ? payouts[0] : 0;
}

function getTrioPayout(result) {
  if (!result || !result.payouts || !result.payouts.trio) return 0;
  const payouts = Object.values(result.payouts.trio);
  return payouts.length > 0 ? payouts[0] : 0;
}

// 本命3モデル一致の分析
function analyzeTopPickThreeModels(races) {
  const allAgree = [];
  const twoAgree = [];
  const oneOrLess = [];

  for (const race of races) {
    const standard = race.predictions.standard.topPick;
    const safeBet = race.predictions.safeBet.topPick;
    const upset = race.predictions.upsetFocus.topPick;

    if (standard === safeBet && safeBet === upset) {
      allAgree.push(race);
    } else if (standard === safeBet || safeBet === upset || standard === upset) {
      twoAgree.push(race);
    } else {
      oneOrLess.push(race);
    }
  }

  // 3モデル一致時の統計
  const allAgreeStats = calculateTopPickStats(allAgree);
  const twoAgreeStats = calculateTopPickStats(twoAgree);
  const oneOrLessStats = calculateTopPickStats(oneOrLess);

  return {
    allAgree: { races: allAgree.length, stats: allAgreeStats },
    twoAgree: { races: twoAgree.length, stats: twoAgreeStats },
    oneOrLess: { races: oneOrLess.length, stats: oneOrLessStats }
  };
}

// トップピック統計計算
function calculateTopPickStats(races) {
  if (races.length === 0) {
    return {
      win: { hits: 0, hitRate: 0, totalInvestment: 0, totalPayout: 0, recoveryRate: 0 },
      place: { hits: 0, hitRate: 0, totalInvestment: 0, totalPayout: 0, recoveryRate: 0 }
    };
  }

  const stats = {
    win: { hits: 0, totalInvestment: races.length * 100, totalPayout: 0 },
    place: { hits: 0, totalInvestment: races.length * 100, totalPayout: 0 }
  };

  for (const race of races) {
    const topPick = race.predictions.standard.topPick;

    // 単勝
    if (race.result.rank1 === topPick) {
      stats.win.hits++;
      stats.win.totalPayout += getWinPayout(race.result, topPick);
    }

    // 複勝
    if (race.result.rank1 === topPick ||
        race.result.rank2 === topPick ||
        race.result.rank3 === topPick) {
      stats.place.hits++;
      stats.place.totalPayout += getPlacePayout(race.result, topPick);
    }
  }

  stats.win.hitRate = stats.win.hits / races.length * 100;
  stats.win.recoveryRate = stats.win.totalPayout / stats.win.totalInvestment * 100;
  stats.place.hitRate = stats.place.hits / races.length * 100;
  stats.place.recoveryRate = stats.place.totalPayout / stats.place.totalInvestment * 100;

  return stats;
}

// トップ3の3モデル一致分析
function analyzeTop3ThreeModels(races) {
  const allAgree = [];
  const notAllAgree = [];

  for (const race of races) {
    const standard = race.predictions.standard.top3;
    const safeBet = race.predictions.safeBet.top3;
    const upset = race.predictions.upsetFocus.top3;

    if (arraysEqual(standard, safeBet) && arraysEqual(safeBet, upset)) {
      allAgree.push(race);
    } else {
      notAllAgree.push(race);
    }
  }

  // 3モデル一致時の統計
  const allAgreeStats = calculateTop3Stats(allAgree);
  const notAllAgreeStats = calculateTop3Stats(notAllAgree);

  return {
    allAgree: { races: allAgree.length, stats: allAgreeStats, raceList: allAgree },
    notAllAgree: { races: notAllAgree.length, stats: notAllAgreeStats }
  };
}

// トップ3統計計算
function calculateTop3Stats(races) {
  if (races.length === 0) {
    return {
      trifecta: { hits: 0, hitRate: 0, totalInvestment: 0, totalPayout: 0, recoveryRate: 0, payouts: [] },
      trio: { hits: 0, hitRate: 0, totalInvestment: 0, totalPayout: 0, recoveryRate: 0, payouts: [] }
    };
  }

  const stats = {
    trifecta: { hits: 0, totalInvestment: races.length * 100, totalPayout: 0, payouts: [] },
    trio: { hits: 0, totalInvestment: races.length * 100, totalPayout: 0, payouts: [] }
  };

  for (const race of races) {
    const top3 = race.predictions.standard.top3;

    // 3連単
    if (race.result.rank1 === top3[0] &&
        race.result.rank2 === top3[1] &&
        race.result.rank3 === top3[2]) {
      stats.trifecta.hits++;
      const payout = getTrifectaPayout(race.result);
      stats.trifecta.totalPayout += payout;
      stats.trifecta.payouts.push(payout);
    }

    // 3連複
    const resultSet = [race.result.rank1, race.result.rank2, race.result.rank3].sort();
    const predictionSet = [...top3].sort();
    if (arraysEqual(resultSet, predictionSet)) {
      stats.trio.hits++;
      const payout = getTrioPayout(race.result);
      stats.trio.totalPayout += payout;
      stats.trio.payouts.push(payout);
    }
  }

  stats.trifecta.hitRate = stats.trifecta.hits / races.length * 100;
  stats.trifecta.recoveryRate = stats.trifecta.totalPayout / stats.trifecta.totalInvestment * 100;
  stats.trio.hitRate = stats.trio.hits / races.length * 100;
  stats.trio.recoveryRate = stats.trio.totalPayout / stats.trio.totalInvestment * 100;

  return stats;
}

// 配当統計
function getPayoutStats(payouts) {
  if (payouts.length === 0) return null;

  const sorted = [...payouts].sort((a, b) => a - b);
  const avg = payouts.reduce((a, b) => a + b, 0) / payouts.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // 標準偏差
  const variance = payouts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / payouts.length;
  const stdDev = Math.sqrt(variance);

  // 最大値除外時の平均
  const avgWithoutMax = payouts.length > 1 ?
    payouts.filter(p => p !== max).reduce((a, b) => a + b, 0) / (payouts.length - 1) : 0;

  return { avg, median, min, max, stdDev, avgWithoutMax };
}

// レポート生成
function generateReport(totalRaces, topPickAnalysis, top3Analysis, dateRange) {
  let report = '';

  report += '='.repeat(100) + '\n';
  report += '3モデル（スタンダード・本命・穴狙い）完全一致分析レポート\n';
  report += '='.repeat(100) + '\n\n';

  report += `分析対象レース数: ${totalRaces}\n`;
  report += `データ期間: ${dateRange.start} ～ ${dateRange.end}\n`;
  report += `（穴狙いモデルは12/19以降のみ存在）\n\n`;

  report += '-'.repeat(100) + '\n';
  report += '1. 本命（トップピック）の3モデル一致度分析\n';
  report += '-'.repeat(100) + '\n\n';

  report += `【一致度】\n`;
  report += `  3モデル完全一致: ${topPickAnalysis.allAgree.races}レース (${(topPickAnalysis.allAgree.races/totalRaces*100).toFixed(2)}%)\n`;
  report += `  2モデル一致: ${topPickAnalysis.twoAgree.races}レース (${(topPickAnalysis.twoAgree.races/totalRaces*100).toFixed(2)}%)\n`;
  report += `  1モデル以下: ${topPickAnalysis.oneOrLess.races}レース (${(topPickAnalysis.oneOrLess.races/totalRaces*100).toFixed(2)}%)\n\n`;

  if (topPickAnalysis.allAgree.races > 0) {
    const stats = topPickAnalysis.allAgree.stats;
    report += `【3モデル完全一致時の成績】\n`;
    report += `  単勝:\n`;
    report += `    的中率: ${stats.win.hitRate.toFixed(2)}% (${stats.win.hits}/${topPickAnalysis.allAgree.races})\n`;
    report += `    回収率: ${stats.win.recoveryRate.toFixed(2)}%\n`;
    report += `    投資額: ${stats.win.totalInvestment}円\n`;
    report += `    払戻額: ${stats.win.totalPayout}円\n\n`;

    report += `  複勝:\n`;
    report += `    的中率: ${stats.place.hitRate.toFixed(2)}% (${stats.place.hits}/${topPickAnalysis.allAgree.races})\n`;
    report += `    回収率: ${stats.place.recoveryRate.toFixed(2)}%\n`;
    report += `    投資額: ${stats.place.totalInvestment}円\n`;
    report += `    払戻額: ${stats.place.totalPayout}円\n\n`;
  }

  if (topPickAnalysis.twoAgree.races > 0) {
    const stats = topPickAnalysis.twoAgree.stats;
    report += `【2モデル一致時の成績（参考）】\n`;
    report += `  単勝的中率: ${stats.win.hitRate.toFixed(2)}% / 回収率: ${stats.win.recoveryRate.toFixed(2)}%\n`;
    report += `  複勝的中率: ${stats.place.hitRate.toFixed(2)}% / 回収率: ${stats.place.recoveryRate.toFixed(2)}%\n\n`;
  }

  report += '-'.repeat(100) + '\n';
  report += '2. トップ3（1-2-3位予想）の3モデル一致度分析\n';
  report += '-'.repeat(100) + '\n\n';

  report += `【一致度】\n`;
  report += `  3モデル完全一致: ${top3Analysis.allAgree.races}レース (${(top3Analysis.allAgree.races/totalRaces*100).toFixed(2)}%)\n`;
  report += `  完全一致以外: ${top3Analysis.notAllAgree.races}レース (${(top3Analysis.notAllAgree.races/totalRaces*100).toFixed(2)}%)\n\n`;

  if (top3Analysis.allAgree.races > 0) {
    const stats = top3Analysis.allAgree.stats;

    report += `【3モデル完全一致時の成績】\n`;
    report += `  3連単:\n`;
    report += `    的中率: ${stats.trifecta.hitRate.toFixed(2)}% (${stats.trifecta.hits}/${top3Analysis.allAgree.races})\n`;
    report += `    回収率: ${stats.trifecta.recoveryRate.toFixed(2)}%\n`;
    report += `    投資額: ${stats.trifecta.totalInvestment}円\n`;
    report += `    払戻額: ${stats.trifecta.totalPayout}円\n\n`;

    report += `  3連複:\n`;
    report += `    的中率: ${stats.trio.hitRate.toFixed(2)}% (${stats.trio.hits}/${top3Analysis.allAgree.races})\n`;
    report += `    回収率: ${stats.trio.recoveryRate.toFixed(2)}%\n`;
    report += `    投資額: ${stats.trio.totalInvestment}円\n`;
    report += `    払戻額: ${stats.trio.totalPayout}円\n\n`;

    // 3連複の配当統計
    if (stats.trio.payouts.length > 0) {
      const payoutStats = getPayoutStats(stats.trio.payouts);
      report += `  3連複配当の詳細:\n`;
      report += `    的中回数: ${stats.trio.hits}回\n`;
      report += `    平均配当: ${payoutStats.avg.toFixed(2)}円\n`;
      report += `    中央値: ${payoutStats.median}円\n`;
      report += `    最小配当: ${payoutStats.min}円\n`;
      report += `    最大配当: ${payoutStats.max}円\n`;
      report += `    標準偏差: ${payoutStats.stdDev.toFixed(2)}円\n`;
      report += `    最大値除外時の平均: ${payoutStats.avgWithoutMax.toFixed(2)}円\n\n`;
    }
  } else {
    report += `【3モデル完全一致時の成績】\n`;
    report += `  ※一致するレースが0件のため、統計なし\n\n`;
  }

  report += '-'.repeat(100) + '\n';
  report += '3. 的中レース詳細（トップ3完全一致時）\n';
  report += '-'.repeat(100) + '\n\n';

  if (top3Analysis.allAgree.races > 0) {
    const trioHits = top3Analysis.allAgree.raceList.filter(race => {
      const top3 = race.predictions.standard.top3;
      const resultSet = [race.result.rank1, race.result.rank2, race.result.rank3].sort();
      const predictionSet = [...top3].sort();
      return arraysEqual(resultSet, predictionSet);
    });

    if (trioHits.length > 0) {
      report += '日付       | 会場   | R | 予想      | 結果      | 3連複配当 | 荒れ度\n';
      report += '-'.repeat(100) + '\n';

      for (const race of trioHits) {
        const predStr = race.predictions.standard.top3.join('-');
        const resStr = [race.result.rank1, race.result.rank2, race.result.rank3].join('-');
        const vol = race.volatility ? race.volatility.score.toFixed(0) : 'N/A';
        const payout = getTrioPayout(race.result);

        report += `${race.date} | ${race.venue.padEnd(4)} | ${String(race.raceNumber).padStart(2)} | `;
        report += `${predStr.padEnd(9)} | ${resStr.padEnd(9)} | ${String(payout).padStart(9)} | ${vol}\n`;
      }
      report += '\n';
    } else {
      report += '※3連複的中レースなし\n\n';
    }
  }

  report += '-'.repeat(100) + '\n';
  report += '4. 重要な発見と考察\n';
  report += '-'.repeat(100) + '\n\n';

  if (topPickAnalysis.allAgree.races > 0) {
    const allAgreeWinRate = topPickAnalysis.allAgree.stats.win.hitRate;
    const twoAgreeWinRate = topPickAnalysis.twoAgree.stats.win.hitRate;

    report += `【3モデル一致の効果（本命）】\n\n`;
    report += `- 3モデル一致時の単勝的中率: ${allAgreeWinRate.toFixed(2)}%\n`;
    report += `- 2モデル一致時の単勝的中率: ${twoAgreeWinRate.toFixed(2)}%\n`;
    report += `- 差: ${(allAgreeWinRate - twoAgreeWinRate > 0 ? '+' : '')}${(allAgreeWinRate - twoAgreeWinRate).toFixed(2)}%ポイント\n\n`;

    if (allAgreeWinRate > twoAgreeWinRate + 10) {
      report += `★ 3モデル一致時は的中率が大幅に向上\n`;
      report += `  → 全モデルが一致する本命は信頼性が非常に高い\n\n`;
    } else if (allAgreeWinRate > twoAgreeWinRate + 5) {
      report += `○ 3モデル一致時は的中率が向上\n\n`;
    } else if (allAgreeWinRate > twoAgreeWinRate) {
      report += `△ 3モデル一致時はやや的中率が高い\n\n`;
    } else {
      report += `✗ 3モデル一致による明確な効果は見られない\n\n`;
    }
  }

  if (top3Analysis.allAgree.races > 0 && top3Analysis.allAgree.stats.trio.hits > 0) {
    const stats = top3Analysis.allAgree.stats.trio;
    const payoutStats = getPayoutStats(stats.payouts);

    report += `【3モデル一致の効果（トップ3）】\n\n`;
    report += `- 3連複的中率: ${stats.hitRate.toFixed(2)}%\n`;
    report += `- 3連複回収率: ${stats.recoveryRate.toFixed(2)}%\n`;
    report += `- 中央値配当: ${payoutStats.median}円\n\n`;

    // 外れ値チェック
    if (payoutStats.max > payoutStats.avgWithoutMax * 3) {
      report += `⚠️ 最大配当${payoutStats.max}円が平均を大きく引き上げている\n`;
      report += `   最大値除外時の回収率: ${(stats.totalPayout - payoutStats.max) / stats.totalInvestment * 100}%程度\n\n`;
    }

    if (stats.recoveryRate > 100) {
      report += `✓ 回収率が100%を超えており、プラス収支の可能性\n\n`;
    }
  }

  report += '='.repeat(100) + '\n';
  report += `レポート生成日時: ${new Date().toLocaleString('ja-JP')}\n`;
  report += '='.repeat(100) + '\n';

  return report;
}

// メイン処理
function main() {
  console.log('予測データを読み込んでいます...');
  const allRaces = loadAllPredictions();

  console.log('3モデル全てがあるレースをフィルタ中...');
  const threeModelsRaces = filterThreeModelsRaces(allRaces);
  console.log(`3モデル存在レース数: ${threeModelsRaces.length}\n`);

  if (threeModelsRaces.length === 0) {
    console.log('3モデル全てのデータがありません。');
    return;
  }

  // 日付範囲
  const dates = threeModelsRaces.map(r => r.date).filter(d => d);
  const dateRange = {
    start: dates.length > 0 ? dates[0] : 'N/A',
    end: dates.length > 0 ? dates[dates.length - 1] : 'N/A'
  };

  console.log('本命の3モデル一致度を分析中...');
  const topPickAnalysis = analyzeTopPickThreeModels(threeModelsRaces);

  console.log('トップ3の3モデル一致度を分析中...');
  const top3Analysis = analyzeTop3ThreeModels(threeModelsRaces);

  console.log('レポートを生成中...\n');
  const report = generateReport(threeModelsRaces.length, topPickAnalysis, top3Analysis, dateRange);

  console.log(report);

  // レポートを保存
  const reportPath = path.join(__dirname, 'three-models-agreement-report.txt');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\nレポートを ${reportPath} に保存しました。`);

  // JSONデータも保存
  const jsonData = {
    generatedAt: new Date().toISOString(),
    totalRaces: threeModelsRaces.length,
    dateRange,
    topPickAnalysis,
    top3Analysis
  };

  const jsonPath = path.join(__dirname, 'three-models-agreement-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log(`データを ${jsonPath} に保存しました。`);
}

main();
