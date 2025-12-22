import fs from 'fs/promises';

console.log('=== 勝敗を分ける要素の統計分析 ===\n');

// 過去の予想データを全て読み込む
const predictionFiles = [
  '2025-12-03.json', '2025-12-04.json', '2025-12-05.json',
  '2025-12-06.json', '2025-12-07.json', '2025-12-08.json',
  '2025-12-09.json', '2025-12-10.json', '2025-12-11.json',
  '2025-12-12.json', '2025-12-13.json', '2025-12-14.json',
  '2025-12-15.json', '2025-12-16.json', '2025-12-17.json',
  '2025-12-18.json', '2025-12-19.json'
];

const allRaces = [];
for (const file of predictionFiles) {
  try {
    const data = JSON.parse(await fs.readFile(`data/predictions/${file}`, 'utf-8'));
    allRaces.push(...data.races.filter(r => r.result?.finished));
  } catch (e) {
    // ファイルがない場合はスキップ
  }
}

console.log(`分析対象: ${allRaces.length}レース\n`);

// 各艇のデータを収集
const racerData = [];
for (const race of allRaces) {
  // レース情報から選手データを取得（racersフィールドがない場合は予想データから推測）
  for (let i = 0; i < 6; i++) {
    const player = race.prediction?.players?.[i];
    if (!player) continue;

    const isWinner = race.result.rank1 === player.number;
    const isPlace = race.result.rank1 === player.number || race.result.rank2 === player.number;
    const isTop3 = [race.result.rank1, race.result.rank2, race.result.rank3].includes(player.number);

    racerData.push({
      // 基本情報
      lane: player.number,
      grade: player.grade,
      age: parseInt(player.age) || 0,

      // 成績
      globalWinRate: parseFloat(player.winRate) || 0,
      localWinRate: parseFloat(player.localWinRate) || 0,

      // 機材
      motor2Rate: parseFloat(player.motor2Rate) || 0,
      boat2Rate: parseFloat(player.boat2Rate) || 0,

      // 結果
      isWinner,
      isPlace,
      isTop3,

      // AIスコア
      aiScore: player.aiScore || 0
    });
  }
}

console.log(`選手データ: ${racerData.length}人分\n`);

// ===============================================
// 分析1: 枠番別の勝率
// ===============================================
console.log('【分析1: 枠番別の勝率】\n');

const laneStats = {};
for (let lane = 1; lane <= 6; lane++) {
  const laneData = racerData.filter(r => r.lane === lane);
  const wins = laneData.filter(r => r.isWinner).length;
  const places = laneData.filter(r => r.isPlace).length;
  const top3s = laneData.filter(r => r.isTop3).length;

  laneStats[lane] = {
    total: laneData.length,
    winRate: wins / laneData.length,
    placeRate: places / laneData.length,
    top3Rate: top3s / laneData.length
  };

  console.log(`${lane}号艇: 勝率 ${(laneStats[lane].winRate * 100).toFixed(2)}%, 複勝率 ${(laneStats[lane].placeRate * 100).toFixed(2)}%, 3着内率 ${(laneStats[lane].top3Rate * 100).toFixed(2)}%`);
}

console.log('\n→ 1号艇の優位性は統計的に確認できる？\n');

// ===============================================
// 分析2: モーター2連率と勝率の関係
// ===============================================
console.log('【分析2: モーター2連率と勝率の関係】\n');

const motorBrackets = [
  { min: 0, max: 30, label: '0-30%' },
  { min: 30, max: 35, label: '30-35%' },
  { min: 35, max: 40, label: '35-40%' },
  { min: 40, max: 45, label: '40-45%' },
  { min: 45, max: 100, label: '45%以上' }
];

motorBrackets.forEach(bracket => {
  const filtered = racerData.filter(r =>
    r.motor2Rate >= bracket.min && r.motor2Rate < bracket.max
  );
  if (filtered.length === 0) return;

  const winRate = filtered.filter(r => r.isWinner).length / filtered.length;
  const placeRate = filtered.filter(r => r.isPlace).length / filtered.length;

  console.log(`モーター${bracket.label}: 勝率 ${(winRate * 100).toFixed(2)}%, 複勝率 ${(placeRate * 100).toFixed(2)}% (n=${filtered.length})`);
});

console.log('\n→ モーター性能が40%を超えると勝率は本当に上がる？\n');

// ===============================================
// 分析3: 級別と勝率
// ===============================================
console.log('【分析3: 級別と勝率の関係】\n');

const gradeStats = {};
['A1', 'A2', 'B1', 'B2'].forEach(grade => {
  const gradeData = racerData.filter(r => r.grade === grade);
  if (gradeData.length === 0) return;

  const winRate = gradeData.filter(r => r.isWinner).length / gradeData.length;
  const placeRate = gradeData.filter(r => r.isPlace).length / gradeData.length;

  gradeStats[grade] = { winRate, placeRate, total: gradeData.length };
  console.log(`${grade}級: 勝率 ${(winRate * 100).toFixed(2)}%, 複勝率 ${(placeRate * 100).toFixed(2)}% (n=${gradeData.length})`);
});

console.log('\n→ A1級の優位性は統計的に有意？\n');

// ===============================================
// 分析4: 当地アドバンテージの効果
// ===============================================
console.log('【分析4: 当地アドバンテージの効果】\n');

const advantageBrackets = [
  { min: -10, max: -1, label: '当地苦手（-1以下）' },
  { min: -1, max: 0, label: '当地やや苦手（-1〜0）' },
  { min: 0, max: 1, label: '当地普通（0〜1）' },
  { min: 1, max: 2, label: '当地やや得意（1〜2）' },
  { min: 2, max: 10, label: '当地得意（2以上）' }
];

advantageBrackets.forEach(bracket => {
  const filtered = racerData.filter(r => {
    const adv = r.localWinRate - r.globalWinRate;
    return adv >= bracket.min && adv < bracket.max;
  });

  if (filtered.length === 0) return;

  const winRate = filtered.filter(r => r.isWinner).length / filtered.length;
  const placeRate = filtered.filter(r => r.isPlace).length / filtered.length;

  console.log(`${bracket.label}: 勝率 ${(winRate * 100).toFixed(2)}%, 複勝率 ${(placeRate * 100).toFixed(2)}% (n=${filtered.length})`);
});

console.log('\n→ 当地勝率が全国勝率を上回る選手は本当に有利？\n');

// ===============================================
// 分析5: 年齢と勝率
// ===============================================
console.log('【分析5: 年齢と勝率の関係】\n');

const ageBrackets = [
  { min: 0, max: 25, label: '20代前半' },
  { min: 25, max: 30, label: '20代後半' },
  { min: 30, max: 35, label: '30代前半' },
  { min: 35, max: 40, label: '30代後半' },
  { min: 40, max: 50, label: '40代' },
  { min: 50, max: 100, label: '50代以上' }
];

ageBrackets.forEach(bracket => {
  const filtered = racerData.filter(r =>
    r.age >= bracket.min && r.age < bracket.max
  );
  if (filtered.length === 0) return;

  const winRate = filtered.filter(r => r.isWinner).length / filtered.length;
  const placeRate = filtered.filter(r => r.isPlace).length / filtered.length;

  console.log(`${bracket.label}: 勝率 ${(winRate * 100).toFixed(2)}%, 複勝率 ${(placeRate * 100).toFixed(2)}% (n=${filtered.length})`);
});

console.log('\n→ ベテランは本当に有利？若手は不利？\n');

// ===============================================
// 分析6: 全国勝率と実際の勝率の相関
// ===============================================
console.log('【分析6: 全国勝率と実際の勝率の相関】\n');

const winRateBrackets = [
  { min: 0, max: 3, label: '3.00未満' },
  { min: 3, max: 4, label: '3.00-4.00' },
  { min: 4, max: 5, label: '4.00-5.00' },
  { min: 5, max: 6, label: '5.00-6.00' },
  { min: 6, max: 7, label: '6.00-7.00' },
  { min: 7, max: 10, label: '7.00以上' }
];

winRateBrackets.forEach(bracket => {
  const filtered = racerData.filter(r =>
    r.globalWinRate >= bracket.min && r.globalWinRate < bracket.max
  );
  if (filtered.length === 0) return;

  const winRate = filtered.filter(r => r.isWinner).length / filtered.length;
  const placeRate = filtered.filter(r => r.isPlace).length / filtered.length;

  console.log(`全国勝率${bracket.label}: 実際の勝率 ${(winRate * 100).toFixed(2)}%, 複勝率 ${(placeRate * 100).toFixed(2)}% (n=${filtered.length})`);
});

console.log('\n→ 全国勝率は実際の勝率を予測できる指標として有効？\n');

// ===============================================
// 分析7: AIスコアと実際の勝率の相関
// ===============================================
console.log('【分析7: 現在のAIスコアの予測精度】\n');

// AIスコア順位と実際の着順の一致率
let aiTop1Correct = 0;
let aiTop3Correct = 0;

for (const race of allRaces) {
  const players = race.prediction?.players || [];
  if (players.length === 0) continue;

  // AIスコアでソート済みなのでplayers[0]が本命
  const aiTopPick = players[0]?.number;
  const aiTop3 = players.slice(0, 3).map(p => p.number);

  if (aiTopPick === race.result.rank1) aiTop1Correct++;

  const actualTop3 = [race.result.rank1, race.result.rank2, race.result.rank3];
  if (aiTop3.every(n => actualTop3.includes(n))) aiTop3Correct++;
}

console.log(`AI本命的中率: ${(aiTop1Correct / allRaces.length * 100).toFixed(2)}% (${aiTop1Correct}/${allRaces.length})`);
console.log(`AI3連複的中率: ${(aiTop3Correct / allRaces.length * 100).toFixed(2)}% (${aiTop3Correct}/${allRaces.length})`);

console.log('\n→ 現在のAIスコア計算式は有効？改善の余地は？\n');

// ===============================================
// 分析8: 複合要素の分析
// ===============================================
console.log('【分析8: 複合要素の効果】\n');

// A1級 × 1号艇
const a1Lane1 = racerData.filter(r => r.grade === 'A1' && r.lane === 1);
if (a1Lane1.length > 0) {
  const winRate = a1Lane1.filter(r => r.isWinner).length / a1Lane1.length;
  console.log(`A1級×1号艇: 勝率 ${(winRate * 100).toFixed(2)}% (n=${a1Lane1.length})`);
}

// 好モーター × 1号艇
const goodMotorLane1 = racerData.filter(r => r.motor2Rate >= 40 && r.lane === 1);
if (goodMotorLane1.length > 0) {
  const winRate = goodMotorLane1.filter(r => r.isWinner).length / goodMotorLane1.length;
  console.log(`好モーター(40%+)×1号艇: 勝率 ${(winRate * 100).toFixed(2)}% (n=${goodMotorLane1.length})`);
}

// A1級 × 好モーター
const a1GoodMotor = racerData.filter(r => r.grade === 'A1' && r.motor2Rate >= 40);
if (a1GoodMotor.length > 0) {
  const winRate = a1GoodMotor.filter(r => r.isWinner).length / a1GoodMotor.length;
  console.log(`A1級×好モーター: 勝率 ${(winRate * 100).toFixed(2)}% (n=${a1GoodMotor.length})`);
}

// 外枠（4-6号艇） × 好モーター
const outsideGoodMotor = racerData.filter(r => r.lane >= 4 && r.motor2Rate >= 45);
if (outsideGoodMotor.length > 0) {
  const winRate = outsideGoodMotor.filter(r => r.isWinner).length / outsideGoodMotor.length;
  console.log(`外枠(4-6)×超好モーター(45%+): 勝率 ${(winRate * 100).toFixed(2)}% (n=${outsideGoodMotor.length})`);
}

console.log('\n→ どの組み合わせが最も効果的？\n');

// ===============================================
// 結論
// ===============================================
console.log('\n【統計分析に基づくモデル設計のヒント】\n');
console.log('この分析結果から、以下を判断してください:');
console.log('1. どの要素が勝敗に最も影響しているか');
console.log('2. 複合要素の効果はあるか');
console.log('3. 現在のAIスコア計算式は最適か');
console.log('4. 新しいモデルを作るべき統計的根拠はあるか');
console.log('');
console.log('→ この結果を基に、データドリブンなモデル設計を行いましょう。');
