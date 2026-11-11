const fs = require('fs');
const path = require('path');

// 全ての予測ファイルを読み込む
function loadAllPredictions() {
  const predictionsDir = path.join(__dirname, '../../data/predictions');
  const files = fs.readdirSync(predictionsDir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));

  const allRaces = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(predictionsDir, file), 'utf8'));
      if (data.races) {
        allRaces.push(...data.races);
      }
    } catch (error) {
      console.error(`Error loading ${file}:`, error.message);
    }
  }

  return allRaces;
}

// 結果が確定しているレースのみをフィルタ
function getFinishedRaces(races) {
  return races.filter(race => race.result && race.result.finished);
}

// AIスコアでランキングを作成
function getAIScoreRanking(players) {
  return players
    .sort((a, b) => b.aiScore - a.aiScore)
    .map((p, index) => ({
      rank: index + 1,
      boatNumber: p.number,
      aiScore: p.aiScore
    }));
}

// 指定したボート番号の実際の着順を取得
function getActualRank(boatNumber, result) {
  if (result.rank1 === boatNumber) return 1;
  if (result.rank2 === boatNumber) return 2;
  if (result.rank3 === boatNumber) return 3;
  return 4; // 4着以下
}

// AIスコア順位別の実際の着順分布を分析
function analyzeByAIScoreRank(races, modelName = 'standard') {
  const rankStats = {
    1: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } },
    2: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } },
    3: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } },
    4: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } },
    5: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } },
    6: { total: 0, ranks: { 1: 0, 2: 0, 3: 0, 4: 0 } }
  };

  for (const race of races) {
    if (!race.predictions || !race.predictions[modelName]) continue;

    const ranking = getAIScoreRanking(race.predictions[modelName].players);

    for (const boat of ranking) {
      const aiRank = boat.rank;
      const actualRank = getActualRank(boat.boatNumber, race.result);

      rankStats[aiRank].total++;
      rankStats[aiRank].ranks[actualRank]++;
    }
  }

  return rankStats;
}

// 荒れ度別の分析
function analyzeByVolatilityAndAIRank(races, modelName = 'standard') {
  const ranges = [
    { min: 0, max: 33, label: '低荒れ度 (0-33)' },
    { min: 34, max: 66, label: '中荒れ度 (34-66)' },
    { min: 67, max: 100, label: '高荒れ度 (67-100)' }
  ];

  const results = [];

  for (const range of ranges) {
    const racesInRange = races.filter(r =>
      r.volatility &&
      r.volatility.score >= range.min &&
      r.volatility.score <= range.max
    );

    const stats = analyzeByAIScoreRank(racesInRange, modelName);

    results.push({
      range: range.label,
      volatilityRange: `${range.min}-${range.max}`,
      totalRaces: racesInRange.length,
      stats
    });
  }

  return results;
}

// AIスコア下位艇（5位・6位）の詳細分析
function analyzeLowScoreBoats(races, modelName = 'standard') {
  const analysis = {
    rank5: {
      total: 0,
      wins: 0,           // 1着
      places: 0,         // 3着以内
      rank1: 0,
      rank2: 0,
      rank3: 0,
      rank4plus: 0
    },
    rank6: {
      total: 0,
      wins: 0,
      places: 0,
      rank1: 0,
      rank2: 0,
      rank3: 0,
      rank4plus: 0
    },
    rank5or6: {
      total: 0,
      anyWin: 0,         // 5位または6位のどちらかが1着
      anyPlace: 0        // 5位または6位のどちらかが3着以内
    }
  };

  for (const race of races) {
    if (!race.predictions || !race.predictions[modelName]) continue;

    const ranking = getAIScoreRanking(race.predictions[modelName].players);

    const rank5Boat = ranking.find(b => b.rank === 5);
    const rank6Boat = ranking.find(b => b.rank === 6);

    if (!rank5Boat || !rank6Boat) continue;

    const rank5Actual = getActualRank(rank5Boat.boatNumber, race.result);
    const rank6Actual = getActualRank(rank6Boat.boatNumber, race.result);

    // AIスコア5位の分析
    analysis.rank5.total++;
    analysis.rank5[`rank${rank5Actual === 4 ? '4plus' : rank5Actual}`]++;
    if (rank5Actual === 1) analysis.rank5.wins++;
    if (rank5Actual <= 3) analysis.rank5.places++;

    // AIスコア6位の分析
    analysis.rank6.total++;
    analysis.rank6[`rank${rank6Actual === 4 ? '4plus' : rank6Actual}`]++;
    if (rank6Actual === 1) analysis.rank6.wins++;
    if (rank6Actual <= 3) analysis.rank6.places++;

    // 5位または6位のどちらかが好走
    analysis.rank5or6.total++;
    if (rank5Actual === 1 || rank6Actual === 1) {
      analysis.rank5or6.anyWin++;
    }
    if (rank5Actual <= 3 || rank6Actual <= 3) {
      analysis.rank5or6.anyPlace++;
    }
  }

  return analysis;
}

// 荒れ度別のAIスコア下位艇分析
function analyzeLowScoreBoatsByVolatility(races, modelName = 'standard') {
  const ranges = [
    { min: 0, max: 33, label: '低荒れ度 (0-33)' },
    { min: 34, max: 66, label: '中荒れ度 (34-66)' },
    { min: 67, max: 100, label: '高荒れ度 (67-100)' }
  ];

  const results = [];

  for (const range of ranges) {
    const racesInRange = races.filter(r =>
      r.volatility &&
      r.volatility.score >= range.min &&
      r.volatility.score <= range.max
    );

    const analysis = analyzeLowScoreBoats(racesInRange, modelName);

    results.push({
      range: range.label,
      totalRaces: racesInRange.length,
      analysis
    });
  }

  return results;
}

// レポートを生成
function generateReport(allStats, volatilityStats, lowScoreAnalysis, lowScoreByVolatility, totalRaces) {
  let report = '';

  report += '='.repeat(100) + '\n';
  report += 'AIスコア下位艇（5位・6位）の実際の成績分析レポート\n';
  report += '='.repeat(100) + '\n\n';

  report += `分析対象レース数: ${totalRaces}\n`;
  report += `データ収集期間: 2025年12月\n`;
  report += `分析モデル: スタンダードモデル\n\n`;

  report += '-'.repeat(100) + '\n';
  report += '1. AIスコア順位別の実際の着順分布（全レース）\n';
  report += '-'.repeat(100) + '\n\n';

  report += 'AIスコア | レース数 | 1着     | 2着     | 3着     | 4着以下  | 3着以内率\n';
  report += '-'.repeat(100) + '\n';

  for (let rank = 1; rank <= 6; rank++) {
    const stats = allStats[rank];
    const total = stats.total;
    const rate1 = total > 0 ? (stats.ranks[1] / total * 100).toFixed(1) : '0.0';
    const rate2 = total > 0 ? (stats.ranks[2] / total * 100).toFixed(1) : '0.0';
    const rate3 = total > 0 ? (stats.ranks[3] / total * 100).toFixed(1) : '0.0';
    const rate4 = total > 0 ? (stats.ranks[4] / total * 100).toFixed(1) : '0.0';
    const placeRate = total > 0 ? ((stats.ranks[1] + stats.ranks[2] + stats.ranks[3]) / total * 100).toFixed(1) : '0.0';

    report += `${String(rank).padEnd(9)} | ${String(total).padEnd(9)} | `;
    report += `${rate1.padEnd(7)}% | ${rate2.padEnd(7)}% | ${rate3.padEnd(7)}% | ${rate4.padEnd(8)}% | ${placeRate}%\n`;
  }

  report += '\n';

  report += '-'.repeat(100) + '\n';
  report += '2. AIスコア下位艇（5位・6位）の詳細分析\n';
  report += '-'.repeat(100) + '\n\n';

  const rank5 = lowScoreAnalysis.rank5;
  const rank6 = lowScoreAnalysis.rank6;
  const rank5or6 = lowScoreAnalysis.rank5or6;

  report += '【AIスコア5位の艇】\n';
  report += `  総レース数: ${rank5.total}\n`;
  report += `  1着: ${rank5.rank1}回 (${(rank5.rank1/rank5.total*100).toFixed(2)}%)\n`;
  report += `  2着: ${rank5.rank2}回 (${(rank5.rank2/rank5.total*100).toFixed(2)}%)\n`;
  report += `  3着: ${rank5.rank3}回 (${(rank5.rank3/rank5.total*100).toFixed(2)}%)\n`;
  report += `  4着以下: ${rank5.rank4plus}回 (${(rank5.rank4plus/rank5.total*100).toFixed(2)}%)\n`;
  report += `  3着以内率: ${(rank5.places/rank5.total*100).toFixed(2)}%\n\n`;

  report += '【AIスコア6位の艇】\n';
  report += `  総レース数: ${rank6.total}\n`;
  report += `  1着: ${rank6.rank1}回 (${(rank6.rank1/rank6.total*100).toFixed(2)}%)\n`;
  report += `  2着: ${rank6.rank2}回 (${(rank6.rank2/rank6.total*100).toFixed(2)}%)\n`;
  report += `  3着: ${rank6.rank3}回 (${(rank6.rank3/rank6.total*100).toFixed(2)}%)\n`;
  report += `  4着以下: ${rank6.rank4plus}回 (${(rank6.rank4plus/rank6.total*100).toFixed(2)}%)\n`;
  report += `  3着以内率: ${(rank6.places/rank6.total*100).toFixed(2)}%\n\n`;

  report += '【5位または6位のどちらかが好走する確率】\n';
  report += `  総レース数: ${rank5or6.total}\n`;
  report += `  5位または6位が1着: ${rank5or6.anyWin}回 (${(rank5or6.anyWin/rank5or6.total*100).toFixed(2)}%)\n`;
  report += `  5位または6位が3着以内: ${rank5or6.anyPlace}回 (${(rank5or6.anyPlace/rank5or6.total*100).toFixed(2)}%)\n\n`;

  report += '-'.repeat(100) + '\n';
  report += '3. 荒れ度別のAIスコア下位艇分析\n';
  report += '-'.repeat(100) + '\n\n';

  for (const item of lowScoreByVolatility) {
    const r5 = item.analysis.rank5;
    const r6 = item.analysis.rank6;
    const r5or6 = item.analysis.rank5or6;

    report += `【${item.range}】 (${item.totalRaces}レース)\n\n`;

    report += '  AIスコア5位:\n';
    report += `    1着率: ${(r5.rank1/r5.total*100).toFixed(2)}% (${r5.rank1}/${r5.total})\n`;
    report += `    3着以内率: ${(r5.places/r5.total*100).toFixed(2)}% (${r5.places}/${r5.total})\n\n`;

    report += '  AIスコア6位:\n';
    report += `    1着率: ${(r6.rank1/r6.total*100).toFixed(2)}% (${r6.rank1}/${r6.total})\n`;
    report += `    3着以内率: ${(r6.places/r6.total*100).toFixed(2)}% (${r6.places}/${r6.total})\n\n`;

    report += '  5位または6位が好走:\n';
    report += `    1着率: ${(r5or6.anyWin/r5or6.total*100).toFixed(2)}% (${r5or6.anyWin}/${r5or6.total})\n`;
    report += `    3着以内率: ${(r5or6.anyPlace/r5or6.total*100).toFixed(2)}% (${r5or6.anyPlace}/${r5or6.total})\n\n`;
  }

  report += '-'.repeat(100) + '\n';
  report += '4. 重要な発見と考察\n';
  report += '-'.repeat(100) + '\n\n';

  // AIスコア5位・6位を除外した場合のシミュレーション
  const rank5PlaceRate = (rank5.places / rank5.total * 100);
  const rank6PlaceRate = (rank6.places / rank6.total * 100);
  const bothExcludeRate = (rank5or6.anyPlace / rank5or6.total * 100);

  report += '【予想から除外できるか？】\n\n';

  report += `- AIスコア5位の艇が3着以内に入る確率: ${rank5PlaceRate.toFixed(2)}%\n`;
  report += `- AIスコア6位の艇が3着以内に入る確率: ${rank6PlaceRate.toFixed(2)}%\n`;
  report += `- 5位または6位が3着以内に入る確率: ${bothExcludeRate.toFixed(2)}%\n\n`;

  if (rank6PlaceRate < 10) {
    report += `★ AIスコア6位の艇は3着以内率が${rank6PlaceRate.toFixed(2)}%と低く、予想から除外できる可能性が高い\n`;
  } else if (rank6PlaceRate < 20) {
    report += `△ AIスコア6位の艇は3着以内率が${rank6PlaceRate.toFixed(2)}%で、除外はリスクあり\n`;
  } else {
    report += `✗ AIスコア6位の艇でも${rank6PlaceRate.toFixed(2)}%の確率で3着以内に入るため、除外は推奨しない\n`;
  }

  report += '\n';

  report += '【荒れ度による影響】\n\n';

  const lowVol = lowScoreByVolatility[0];
  const highVol = lowScoreByVolatility[2];

  const lowVolRate5 = (lowVol.analysis.rank5.places / lowVol.analysis.rank5.total * 100);
  const highVolRate5 = (highVol.analysis.rank5.places / highVol.analysis.rank5.total * 100);
  const lowVolRate6 = (lowVol.analysis.rank6.places / lowVol.analysis.rank6.total * 100);
  const highVolRate6 = (highVol.analysis.rank6.places / highVol.analysis.rank6.total * 100);

  report += `- AIスコア5位: 低荒れ度${lowVolRate5.toFixed(2)}% → 高荒れ度${highVolRate5.toFixed(2)}%\n`;
  report += `- AIスコア6位: 低荒れ度${lowVolRate6.toFixed(2)}% → 高荒れ度${highVolRate6.toFixed(2)}%\n\n`;

  if (highVolRate5 > lowVolRate5 || highVolRate6 > lowVolRate6) {
    report += '★ 荒れたレースでは下位艇が好走する傾向が見られる\n';
  } else {
    report += '- 荒れ度による大きな差は見られない\n';
  }

  report += '\n';
  report += '='.repeat(100) + '\n';
  report += `レポート生成日時: ${new Date().toLocaleString('ja-JP')}\n`;
  report += '='.repeat(100) + '\n';

  return report;
}

// メイン処理
function main() {
  console.log('予測データを読み込んでいます...');
  const allRaces = loadAllPredictions();
  console.log(`総レース数: ${allRaces.length}`);

  const finishedRaces = getFinishedRaces(allRaces);
  console.log(`結果確定レース数: ${finishedRaces.length}\n`);

  if (finishedRaces.length === 0) {
    console.log('分析対象のレースがありません。');
    return;
  }

  console.log('AIスコア順位別の着順分布を分析中...');
  const allStats = analyzeByAIScoreRank(finishedRaces, 'standard');

  console.log('荒れ度別の分析中...');
  const volatilityStats = analyzeByVolatilityAndAIRank(finishedRaces, 'standard');

  console.log('AIスコア下位艇の詳細分析中...');
  const lowScoreAnalysis = analyzeLowScoreBoats(finishedRaces, 'standard');

  console.log('荒れ度別のAIスコア下位艇分析中...');
  const lowScoreByVolatility = analyzeLowScoreBoatsByVolatility(finishedRaces, 'standard');

  console.log('レポートを生成中...\n');
  const report = generateReport(allStats, volatilityStats, lowScoreAnalysis, lowScoreByVolatility, finishedRaces.length);

  console.log(report);

  // レポートをファイルに保存
  const reportPath = path.join(__dirname, 'low-score-boats-analysis-report.txt');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\nレポートを ${reportPath} に保存しました。`);

  // JSON形式でも保存
  const jsonData = {
    generatedAt: new Date().toISOString(),
    totalRaces: finishedRaces.length,
    allStats,
    volatilityStats,
    lowScoreAnalysis,
    lowScoreByVolatility
  };

  const jsonPath = path.join(__dirname, 'low-score-boats-analysis-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
  console.log(`データを ${jsonPath} に保存しました。`);
}

main();
