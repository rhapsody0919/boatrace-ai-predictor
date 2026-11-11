const fs = require('fs');
const path = require('path');

// 予測データを再読み込みして詳細を確認
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
    } catch {
      // エラーは無視
    }
  }

  return allRaces;
}

// 配列が完全に一致するかチェック
function arraysEqual(arr1, arr2) {
  if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
  return arr1.every((val, index) => val === arr2[index]);
}

// 3連複配当を取得
function getTrioPayout(result) {
  if (!result || !result.payouts || !result.payouts.trio) return 0;
  const payouts = Object.values(result.payouts.trio);
  return payouts.length > 0 ? payouts[0] : 0;
}

// 完全一致レースの詳細を抽出
function extractFullMatchRaces(races) {
  const fullMatch = [];

  for (const race of races) {
    if (!race.predictions ||
        !race.predictions.standard ||
        !race.predictions.upsetFocus ||
        !race.result ||
        !race.result.finished) {
      continue;
    }

    const standardTop3 = race.predictions.standard.top3;
    const upsetTop3 = race.predictions.upsetFocus.top3;

    // 完全一致チェック
    if (arraysEqual(standardTop3, upsetTop3)) {
      // 3連複的中チェック
      const resultSet = [race.result.rank1, race.result.rank2, race.result.rank3].sort();
      const predictionSet = [...standardTop3].sort();
      const trioHit = arraysEqual(resultSet, predictionSet);

      const trioPayout = getTrioPayout(race.result);

      fullMatch.push({
        raceId: race.raceId,
        date: race.date,
        venue: race.venue,
        raceNumber: race.raceNumber,
        prediction: standardTop3,
        result: [race.result.rank1, race.result.rank2, race.result.rank3],
        trioHit,
        trioPayout,
        volatility: race.volatility ? race.volatility.score : null
      });
    }
  }

  return fullMatch;
}

// 統計計算
function calculateStats(races) {
  const hits = races.filter(r => r.trioHit);
  const totalInvestment = races.length * 100;
  const totalPayout = races.reduce((sum, r) => sum + (r.trioHit ? r.trioPayout : 0), 0);
  const recoveryRate = totalInvestment > 0 ? (totalPayout / totalInvestment * 100) : 0;

  // 的中レースの配当分布
  const hitPayouts = hits.map(r => r.trioPayout);
  const avgPayout = hitPayouts.length > 0 ? hitPayouts.reduce((a, b) => a + b, 0) / hitPayouts.length : 0;

  // 標準偏差
  let stdDev = 0;
  if (hitPayouts.length > 1) {
    const variance = hitPayouts.reduce((sum, val) => sum + Math.pow(val - avgPayout, 2), 0) / hitPayouts.length;
    stdDev = Math.sqrt(variance);
  }

  // 中央値
  const median = hitPayouts.length > 0 ?
    hitPayouts.sort((a, b) => a - b)[Math.floor(hitPayouts.length / 2)] : 0;

  return {
    totalRaces: races.length,
    hits: hits.length,
    hitRate: races.length > 0 ? (hits.length / races.length * 100) : 0,
    totalInvestment,
    totalPayout,
    recoveryRate,
    avgPayout,
    median,
    stdDev,
    hitPayouts
  };
}

// レポート生成
function generateReport(fullMatchRaces, stats) {
  let report = '';

  report += '='.repeat(100) + '\n';
  report += 'モデル完全一致時の3連複回収率 検証レポート\n';
  report += '='.repeat(100) + '\n\n';

  report += '【計算ロジックの説明】\n\n';
  report += '1. 完全一致レースを抽出:\n';
  report += '   - スタンダードモデルのtop3 = 穴狙いモデルのtop3（順序も同じ）\n';
  report += `   - 該当レース数: ${fullMatchRaces.length}レース\n\n`;

  report += '2. 各レースで100円購入と仮定:\n';
  report += `   - 総投資額 = ${fullMatchRaces.length}レース × 100円 = ${stats.totalInvestment}円\n\n`;

  report += '3. 3連複的中時のみ配当を加算:\n';
  report += '   - 予想したtop3の艇番号（順序不問）が実際の1-2-3着と一致\n';
  report += `   - 的中回数: ${stats.hits}回\n`;
  report += `   - 的中率: ${stats.hitRate.toFixed(2)}%\n\n`;

  report += '4. 回収率を計算:\n';
  report += `   - 総払戻額: ${stats.totalPayout}円\n`;
  report += `   - 回収率 = ${stats.totalPayout}円 ÷ ${stats.totalInvestment}円 × 100\n`;
  report += `   - 回収率 = ${stats.recoveryRate.toFixed(2)}%\n\n`;

  report += '-'.repeat(100) + '\n';
  report += '【実際の的中レース一覧】\n';
  report += '-'.repeat(100) + '\n\n';

  const hits = fullMatchRaces.filter(r => r.trioHit);

  if (hits.length > 0) {
    report += '日付       | 会場   | R | 予想      | 結果      | 配当(円) | 荒れ度\n';
    report += '-'.repeat(100) + '\n';

    for (const race of hits) {
      const predStr = race.prediction.join('-');
      const resStr = race.result.join('-');
      const vol = race.volatility !== null ? race.volatility.toFixed(0) : 'N/A';

      report += `${race.date} | ${race.venue.padEnd(4)} | ${String(race.raceNumber).padStart(2)} | `;
      report += `${predStr.padEnd(9)} | ${resStr.padEnd(9)} | ${String(race.trioPayout).padStart(8)} | ${vol}\n`;
    }

    report += '\n';
  } else {
    report += '※的中レースなし\n\n';
  }

  report += '-'.repeat(100) + '\n';
  report += '【配当分布の統計】\n';
  report += '-'.repeat(100) + '\n\n';

  if (stats.hitPayouts.length > 0) {
    report += `的中回数: ${stats.hits}回\n`;
    report += `平均配当: ${stats.avgPayout.toFixed(2)}円\n`;
    report += `中央値: ${stats.median}円\n`;
    report += `標準偏差: ${stats.stdDev.toFixed(2)}円\n`;
    report += `最小配当: ${Math.min(...stats.hitPayouts)}円\n`;
    report += `最大配当: ${Math.max(...stats.hitPayouts)}円\n\n`;

    // 配当帯別の分布
    const ranges = [
      { min: 0, max: 1000, label: '～1,000円' },
      { min: 1001, max: 2000, label: '1,001～2,000円' },
      { min: 2001, max: 5000, label: '2,001～5,000円' },
      { min: 5001, max: 10000, label: '5,001～10,000円' },
      { min: 10001, max: Infinity, label: '10,001円～' }
    ];

    report += '配当帯別分布:\n';
    for (const range of ranges) {
      const count = stats.hitPayouts.filter(p => p >= range.min && p <= range.max).length;
      if (count > 0) {
        report += `  ${range.label.padEnd(20)}: ${count}回\n`;
      }
    }
    report += '\n';
  }

  report += '-'.repeat(100) + '\n';
  report += '【信頼性の検証】\n';
  report += '-'.repeat(100) + '\n\n';

  report += `1. サンプル数の評価:\n`;
  report += `   - 完全一致レース数: ${fullMatchRaces.length}レース\n`;
  report += `   - 的中回数: ${stats.hits}回\n`;

  if (fullMatchRaces.length < 30) {
    report += `   - ⚠️ サンプル数が少ない（30未満）ため、統計的信頼性は低い\n\n`;
  } else if (fullMatchRaces.length < 100) {
    report += `   - △ サンプル数はやや少ない（100未満）が、参考値として有用\n\n`;
  } else {
    report += `   - ✓ サンプル数は十分（100以上）\n\n`;
  }

  report += `2. 外れ値の影響:\n`;
  if (stats.hitPayouts.length > 0) {
    const maxPayout = Math.max(...stats.hitPayouts);
    const avgWithoutMax = stats.hitPayouts.length > 1 ?
      stats.hitPayouts.filter(p => p !== maxPayout).reduce((a, b) => a + b, 0) / (stats.hitPayouts.length - 1) : 0;

    report += `   - 最大配当: ${maxPayout}円\n`;
    report += `   - 最大配当除外時の平均: ${avgWithoutMax.toFixed(2)}円\n`;

    if (maxPayout > avgWithoutMax * 3) {
      report += `   - ⚠️ 最大配当が平均の3倍以上で、外れ値の影響が大きい可能性\n\n`;
    } else {
      report += `   - ✓ 外れ値の影響は限定的\n\n`;
    }
  } else {
    report += `   - N/A（的中なし）\n\n`;
  }

  report += `3. 標準偏差の評価:\n`;
  if (stats.hitPayouts.length > 0) {
    const cv = (stats.stdDev / stats.avgPayout) * 100; // 変動係数
    report += `   - 変動係数: ${cv.toFixed(2)}%\n`;

    if (cv > 100) {
      report += `   - ⚠️ 変動が非常に大きく、配当のばらつきが激しい\n\n`;
    } else if (cv > 50) {
      report += `   - △ 変動がやや大きい\n\n`;
    } else {
      report += `   - ✓ 変動は許容範囲内\n\n`;
    }
  } else {
    report += `   - N/A（的中なし）\n\n`;
  }

  report += '-'.repeat(100) + '\n';
  report += '【結論】\n';
  report += '-'.repeat(100) + '\n\n';

  if (fullMatchRaces.length < 30) {
    report += `⚠️ サンプル数が少ないため、回収率${stats.recoveryRate.toFixed(2)}%の信頼性は低い\n`;
    report += `   より多くのデータ収集が必要\n`;
  } else if (stats.hits < 10) {
    report += `△ 的中回数が少ないため、回収率${stats.recoveryRate.toFixed(2)}%は参考値\n`;
    report += `   今後のデータで検証が必要\n`;
  } else {
    const cv = stats.hitPayouts.length > 0 ? (stats.stdDev / stats.avgPayout) * 100 : 0;
    if (cv > 100) {
      report += `△ 回収率${stats.recoveryRate.toFixed(2)}%は計算上正しいが、配当のばらつきが大きい\n`;
      report += `   一部の高配当レースが結果を大きく押し上げている可能性\n`;
    } else {
      report += `✓ 回収率${stats.recoveryRate.toFixed(2)}%は統計的に一定の信頼性がある\n`;
      report += `   ただし、今後も継続的な検証が必要\n`;
    }
  }

  report += '\n';
  report += '='.repeat(100) + '\n';
  report += `検証日時: ${new Date().toLocaleString('ja-JP')}\n`;
  report += '='.repeat(100) + '\n';

  return report;
}

// メイン処理
function main() {
  console.log('予測データを読み込んでいます...');
  const allRaces = loadAllPredictions();

  console.log('完全一致レースを抽出中...');
  const fullMatchRaces = extractFullMatchRaces(allRaces);
  console.log(`完全一致レース数: ${fullMatchRaces.length}\n`);

  console.log('統計を計算中...');
  const stats = calculateStats(fullMatchRaces);

  console.log('検証レポートを生成中...\n');
  const report = generateReport(fullMatchRaces, stats);

  console.log(report);

  // レポートを保存
  const reportPath = path.join(__dirname, 'agreement-verification-report.txt');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`\n検証レポートを ${reportPath} に保存しました。`);
}

main();
