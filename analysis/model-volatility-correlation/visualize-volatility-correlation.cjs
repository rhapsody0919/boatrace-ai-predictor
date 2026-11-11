const fs = require('fs');
const path = require('path');

// JSONデータを読み込む
function loadData() {
  const dataPath = path.join(__dirname, 'model-volatility-correlation-data.json');
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

// ASCIIグラフを生成
function generateASCIIGraph(detailedStats) {
  let output = '';

  output += '\n' + '='.repeat(100) + '\n';
  output += '荒れ度別モデル的中率グラフ\n';
  output += '='.repeat(100) + '\n\n';

  const maxRate = 80; // グラフの最大値（%）
  const graphWidth = 60;

  output += '的中率(%)   0    10   20   30   40   50   60   70   80\n';
  output += '            ' + '|----|----|----|----|----|----|----|----|'.substring(0, graphWidth) + '\n';

  for (const stat of detailedStats) {
    output += `\n【荒れ度 ${stat.range}】 (${stat.totalRaces}レース)\n`;

    ['standard', 'safeBet', 'upsetFocus'].forEach(modelName => {
      if (stat.models[modelName]) {
        const rate = stat.models[modelName].hitRate * 100;
        const barLength = Math.round((rate / maxRate) * graphWidth);
        const bar = '█'.repeat(barLength);

        const displayName = modelName === 'standard' ? 'スタンダード' :
                            modelName === 'safeBet' ? '本命      ' :
                            modelName === 'upsetFocus' ? '穴狙い    ' : modelName;

        output += `  ${displayName}: ${bar} ${rate.toFixed(1)}%\n`;
      }
    });
  }

  output += '\n' + '='.repeat(100) + '\n\n';

  return output;
}

// 相対パフォーマンス分析
function analyzeRelativePerformance(basicStats) {
  let output = '';

  output += '='.repeat(100) + '\n';
  output += '相対パフォーマンス分析\n';
  output += '='.repeat(100) + '\n\n';

  const lowVol = basicStats[0];
  const midVol = basicStats[1];
  const highVol = basicStats[2];

  output += '各モデルの的中率低下率（低荒れ度 → 高荒れ度）:\n\n';

  ['standard', 'safeBet', 'upsetFocus'].forEach(modelName => {
    const displayName = modelName === 'standard' ? 'スタンダードモデル' :
                        modelName === 'safeBet' ? '本命モデル      ' :
                        modelName === 'upsetFocus' ? '穴狙いモデル    ' : modelName;

    const lowRate = lowVol.models[modelName].hitRate * 100;
    const highRate = highVol.models[modelName].hitRate * 100;
    const decrease = lowRate - highRate;
    const decreasePercent = (decrease / lowRate) * 100;

    output += `  ${displayName}: ${lowRate.toFixed(2)}% → ${highRate.toFixed(2)}% `;
    output += `(${decrease.toFixed(2)}%ポイント低下, ${decreasePercent.toFixed(1)}%減)\n`;
  });

  output += '\n';
  output += '【解釈】\n';
  output += '- 低下率が小さいモデルほど、荒れたレースへの耐性が高い\n';
  output += '- 穴狙いモデルは絶対的な的中率は低いが、荒れ度への耐性が相対的に高い可能性\n';
  output += '\n';

  // 各荒れ度区間での最適モデル
  output += '各荒れ度区間での最高的中率モデル:\n\n';

  [lowVol, midVol, highVol].forEach(stat => {
    const bestModel = Object.entries(stat.models)
      .sort((a, b) => b[1].hitRate - a[1].hitRate)[0];

    const modelName = bestModel[0];
    const displayName = modelName === 'standard' ? 'スタンダード' :
                        modelName === 'safeBet' ? '本命' :
                        modelName === 'upsetFocus' ? '穴狙い' : modelName;

    output += `  ${stat.range}: ${displayName} (${(bestModel[1].hitRate * 100).toFixed(2)}%)\n`;
  });

  output += '\n' + '='.repeat(100) + '\n\n';

  return output;
}

// 統計的有意性の簡易検証
function analyzeStatisticalSignificance(basicStats) {
  let output = '';

  output += '='.repeat(100) + '\n';
  output += '統計的有意性の検証\n';
  output += '='.repeat(100) + '\n\n';

  const lowVol = basicStats[0];
  const highVol = basicStats[2];

  output += '低荒れ度 vs 高荒れ度での各モデルの的中率差:\n\n';

  ['standard', 'safeBet', 'upsetFocus'].forEach(modelName => {
    const displayName = modelName === 'standard' ? 'スタンダードモデル' :
                        modelName === 'safeBet' ? '本命モデル      ' :
                        modelName === 'upsetFocus' ? '穴狙いモデル    ' : modelName;

    const lowData = lowVol.models[modelName];
    const highData = highVol.models[modelName];

    const lowRate = lowData.hitRate;
    const highRate = highData.hitRate;

    // 簡易的なZ検定（2標本の割合の差の検定）
    const p1 = lowData.hits / lowData.totalRaces;
    const p2 = highData.hits / highData.totalRaces;
    const n1 = lowData.totalRaces;
    const n2 = highData.totalRaces;

    const pPooled = (lowData.hits + highData.hits) / (n1 + n2);
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1/n1 + 1/n2));
    const zScore = (p1 - p2) / se;

    const significant = Math.abs(zScore) > 1.96; // 95%信頼水準

    output += `  ${displayName}:\n`;
    output += `    低荒れ度: ${(lowRate * 100).toFixed(2)}% (${lowData.hits}/${lowData.totalRaces})\n`;
    output += `    高荒れ度: ${(highRate * 100).toFixed(2)}% (${highData.hits}/${highData.totalRaces})\n`;
    output += `    Z値: ${zScore.toFixed(3)}\n`;
    output += `    統計的に有意: ${significant ? 'はい (p < 0.05)' : 'いいえ'}\n\n`;
  });

  output += '【解釈】\n';
  output += '- Z値の絶対値が1.96以上の場合、95%の信頼水準で有意差あり\n';
  output += '- 荒れ度による的中率の差が偶然ではない可能性が高い\n';
  output += '\n' + '='.repeat(100) + '\n\n';

  return output;
}

// 推奨モデル精度の検証
function analyzeRecommendedModelAccuracy(races) {
  let output = '';

  output += '='.repeat(100) + '\n';
  output += '推奨モデルの精度検証\n';
  output += '='.repeat(100) + '\n\n';

  output += '各レースには荒れ度に基づいて推奨モデルが設定されています。\n';
  output += 'その推奨モデルが実際に最も高い的中率だったかを検証します。\n\n';

  const finishedRaces = races.filter(r => r.result && r.result.finished);

  let correctRecommendations = 0;
  let totalWithRecommendation = 0;

  const modelMapping = {
    'standard': 'standard',
    'safe-bet': 'safeBet',
    'safeBet': 'safeBet',
    'upset-focus': 'upsetFocus',
    'upsetFocus': 'upsetFocus'
  };

  const byVolatilityLevel = {
    'low': { total: 0, correct: 0 },
    'medium': { total: 0, correct: 0 },
    'high': { total: 0, correct: 0 }
  };

  for (const race of finishedRaces) {
    if (!race.volatility || !race.volatility.recommendedModel || !race.predictions) continue;

    totalWithRecommendation++;

    const recommendedModelKey = modelMapping[race.volatility.recommendedModel];
    if (!recommendedModelKey) continue;

    // 各モデルの的中を確認
    const modelResults = {};
    for (const [modelName, prediction] of Object.entries(race.predictions)) {
      if (prediction.topPick === race.result.rank1) {
        modelResults[modelName] = true;
      }
    }

    // 推奨モデルが的中したか
    if (modelResults[recommendedModelKey]) {
      correctRecommendations++;

      // 他のモデルが外れているかも確認
      const allModelsHit = Object.values(modelResults).every(hit => hit);
      if (!allModelsHit) {
        // 推奨モデルだけが的中（または推奨モデルを含む一部が的中）
      }
    }

    // 荒れ度レベル別に集計
    const volLevel = race.volatility.level;
    if (byVolatilityLevel[volLevel]) {
      byVolatilityLevel[volLevel].total++;
      if (modelResults[recommendedModelKey]) {
        byVolatilityLevel[volLevel].correct++;
      }
    }
  }

  output += `推奨モデル的中率: ${(correctRecommendations / totalWithRecommendation * 100).toFixed(2)}% `;
  output += `(${correctRecommendations}/${totalWithRecommendation})\n\n`;

  output += '荒れ度レベル別の推奨モデル的中率:\n\n';
  for (const [level, data] of Object.entries(byVolatilityLevel)) {
    const levelName = level === 'low' ? '低' : level === 'medium' ? '中' : '高';
    const rate = data.total > 0 ? (data.correct / data.total * 100).toFixed(2) : 'N/A';
    output += `  ${levelName}荒れ度: ${rate}% (${data.correct}/${data.total})\n`;
  }

  output += '\n' + '='.repeat(100) + '\n\n';

  return output;
}

// メイン処理
function main() {
  console.log('データを読み込んでいます...\n');
  const data = loadData();

  let report = '';

  // グラフ生成
  report += generateASCIIGraph(data.detailedStats);

  // 相対パフォーマンス分析
  report += analyzeRelativePerformance(data.basicStats);

  // 統計的有意性検証
  report += analyzeStatisticalSignificance(data.basicStats);

  // 推奨モデル精度検証のため、元データを再読み込み
  console.log('追加分析のため予測データを読み込んでいます...');
  const predictionsDir = path.join(__dirname, 'data/predictions');
  const files = fs.readdirSync(predictionsDir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/));

  const allRaces = [];
  for (const file of files) {
    try {
      const fileData = JSON.parse(fs.readFileSync(path.join(predictionsDir, file), 'utf8'));
      if (fileData.races) {
        allRaces.push(...fileData.races);
      }
    } catch {
      // エラーは無視
    }
  }

  report += analyzeRecommendedModelAccuracy(allRaces);

  console.log(report);

  // レポートを保存
  const reportPath = path.join(__dirname, 'model-volatility-visualization-report.txt');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\nレポートを ${reportPath} に保存しました。`);
}

main();
