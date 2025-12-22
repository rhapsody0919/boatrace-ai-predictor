import fs from 'fs/promises';

console.log('=== 回収率の再現性分析 ===\n');

// summary.jsonから日別履歴を確認
const summary = JSON.parse(await fs.readFile('data/predictions/summary.json', 'utf-8'));

console.log('【統計的信頼性の検証】\n');

// 各モデルのデータを分析
const models = {
  'standard': 'スタンダード',
  'safeBet': '本命狙い',
  'upsetFocus': '穴狙い'
};

for (const [key, name] of Object.entries(models)) {
  const data = summary.models[key]?.overall;

  if (!data) continue;

  console.log(`【${name}モデル】`);
  console.log(`サンプル数: ${data.finishedRaces}レース`);
  console.log('');

  // 的中率と回収率の関係
  const hitRate = data.topPickHitRate;
  const recovery = data.actualRecovery.trio.recoveryRate;
  const avgPayout = recovery / hitRate; // 的中時の平均配当倍率

  console.log('3連単の分析:');
  console.log(`  的中率: ${(hitRate * 100).toFixed(2)}%`);
  console.log(`  回収率: ${(recovery * 100).toFixed(2)}%`);
  console.log(`  的中時平均配当: ${avgPayout.toFixed(2)}倍`);
  console.log(`  期待値: ${((recovery - 1) * 100).toFixed(2)}%`);

  // 統計的優位性の判定
  const confidence = 1.96; // 95%信頼区間
  const n = data.finishedRaces;
  const p = hitRate;
  const se = Math.sqrt(p * (1 - p) / n); // 標準誤差
  const margin = confidence * se;

  console.log(`  95%信頼区間: ${((p - margin) * 100).toFixed(2)}% - ${((p + margin) * 100).toFixed(2)}%`);

  // 理論的な最低回収率の計算
  const minRecovery = (p - margin) * avgPayout;
  const maxRecovery = (p + margin) * avgPayout;

  console.log(`  回収率の信頼区間: ${(minRecovery * 100).toFixed(2)}% - ${(maxRecovery * 100).toFixed(2)}%`);

  // 再現性の評価
  if (minRecovery > 1.0) {
    console.log(`  ✅ 再現性: 高い（95%の確率で期待値プラス）`);
  } else if (recovery > 1.0) {
    console.log(`  ⚠️  再現性: 中程度（期待値はプラスだが変動リスクあり）`);
  } else {
    console.log(`  ❌ 再現性: 低い（期待値マイナス）`);
  }

  console.log('');
}

// 日別の変動を確認
console.log('\n【日別パフォーマンスの安定性】\n');

if (summary.models?.standard?.dailyHistory) {
  const daily = summary.models.standard.dailyHistory;

  // 直近10日間の回収率を取得
  const recent = daily.slice(-10);

  console.log('直近10日間の3連単回収率:');
  recent.forEach(day => {
    const recovery = day.actualRecovery?.trio?.recoveryRate || 0;
    const bar = '█'.repeat(Math.floor(recovery / 0.2));
    console.log(`  ${day.date}: ${(recovery * 100).toFixed(1)}% ${bar}`);
  });

  // 標準偏差を計算
  const recoveries = recent.map(d => d.actualRecovery?.trio?.recoveryRate || 0);
  const avg = recoveries.reduce((sum, r) => sum + r, 0) / recoveries.length;
  const variance = recoveries.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / recoveries.length;
  const stdDev = Math.sqrt(variance);

  console.log('');
  console.log(`平均回収率: ${(avg * 100).toFixed(2)}%`);
  console.log(`標準偏差: ${(stdDev * 100).toFixed(2)}%`);
  console.log(`変動係数: ${(stdDev / avg * 100).toFixed(2)}%`);

  if (stdDev / avg < 0.5) {
    console.log('✅ パフォーマンスは安定している');
  } else {
    console.log('⚠️  パフォーマンスの変動が大きい');
  }
}

// 会場別の実績
console.log('\n【会場別パフォーマンス】\n');

if (summary.models?.upsetFocus?.byVenue) {
  const venues = summary.models.upsetFocus.byVenue;
  const venueNames = {
    1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
    7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
    13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
    19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
  };

  console.log('穴狙いモデルの会場別3連単回収率（上位5会場）:');

  const venueList = Object.entries(venues)
    .map(([code, data]) => ({
      code: parseInt(code),
      name: venueNames[code],
      recovery: data.overall?.actualRecovery?.trio?.recoveryRate || 0,
      races: data.overall?.finishedRaces || 0
    }))
    .filter(v => v.races >= 10) // 10レース以上
    .sort((a, b) => b.recovery - a.recovery);

  venueList.slice(0, 5).forEach((v, idx) => {
    console.log(`  ${idx + 1}. ${v.name}: ${(v.recovery * 100).toFixed(1)}% (${v.races}レース)`);
  });

  console.log('');
  console.log('回収率が低い会場（下位3会場）:');
  venueList.slice(-3).reverse().forEach((v, idx) => {
    console.log(`  ${v.name}: ${(v.recovery * 100).toFixed(1)}% (${v.races}レース)`);
  });
}
