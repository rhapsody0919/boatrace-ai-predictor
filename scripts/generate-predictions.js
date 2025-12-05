// AI予想生成スクリプト
// data/races.json を読み込んで、data/predictions/YYYY-MM-DD.json を生成

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日本時間で今日の日付を取得 (YYYY-MM-DD形式)
function getTodayDateJST() {
  const now = new Date();
  // JSTはUTC+9時間
  const jstOffset = 9 * 60;
  const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000);
  return jstDate.toISOString().split('T')[0];
}

// AIスコアを計算（App.jsxのgeneratePlayersロジックを移植）
function calculateAIScore(racer, index) {
  return Math.floor(
    racer.globalWinRate * 100 +
    racer.local2Rate * 50 +
    racer.motor2Rate * 30 +
    racer.boat2Rate * 20 -
    index * 5
  );
}

// 選手データを処理してAIスコア順にソート
function processRacers(racers) {
  if (!racers || racers.length === 0) {
    console.warn('⚠️  選手データが空です');
    return [];
  }

  const players = racers.map((racer, idx) => ({
    number: racer.lane,
    name: racer.name,
    grade: racer.grade,
    age: racer.age,
    winRate: racer.globalWinRate.toFixed(3),
    localWinRate: racer.localWinRate.toFixed(3),
    motorNumber: racer.motorNumber,
    motor2Rate: racer.motor2Rate.toFixed(1),
    boatNumber: racer.boatNumber,
    boat2Rate: racer.boat2Rate.toFixed(1),
    aiScore: calculateAIScore(racer, idx),
  }));

  // AIスコア順にソート
  return players.sort((a, b) => b.aiScore - a.aiScore);
}

// 予想根拠を生成（App.jsxのgenerateInsightsロジックを移植）
function generateInsights(players) {
  const insights = [];

  // 当地勝率が最も高い選手
  const topLocalWinRate = [...players].sort((a, b) =>
    parseFloat(b.localWinRate) - parseFloat(a.localWinRate)
  )[0];

  if (topLocalWinRate) {
    insights.push(
      `${topLocalWinRate.number}号艇の${topLocalWinRate.name}選手は` +
      `当レース場での勝率が${topLocalWinRate.localWinRate}と最も高い`
    );
  }

  // モーター2率が40%以上の選手
  const goodMotors = players.filter(p => parseFloat(p.motor2Rate) > 40);
  if (goodMotors.length > 0) {
    const motorList = goodMotors.map(p =>
      `${p.number}号艇（${p.motor2Rate}%）`
    ).join('、');
    insights.push(
      `${motorList}のモーターは2連率が高く好調`
    );
  }

  // 全国勝率が7.0以上の選手
  const topRacers = players.filter(p => parseFloat(p.winRate) >= 7.0);
  if (topRacers.length > 0) {
    const racerList = topRacers.map(p =>
      `${p.number}号艇（勝率${p.winRate}）`
    ).join('、');
    insights.push(
      `${racerList}は全国勝率が高い実力者`
    );
  }

  return insights;
}

// レースIDを生成
function generateRaceId(date, placeCd, raceNo) {
  return `${date}-${String(placeCd).padStart(2, '0')}-${String(raceNo).padStart(2, '0')}`;
}

// 信頼度を計算（トップピックのAIスコアと2位のAIスコアの差から算出）
function calculateConfidence(players) {
  if (players.length < 2) return 70;

  const scoreDiff = players[0].aiScore - players[1].aiScore;
  // スコア差が大きいほど信頼度が高い（70-95%の範囲）
  const confidence = Math.min(95, Math.max(70, 70 + Math.floor(scoreDiff / 10)));
  return confidence;
}

// 1レース分の予想を生成
function generateRacePrediction(race, date) {
  const players = processRacers(race.racers);

  if (players.length === 0) {
    console.warn(`⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`);
    return null;
  }

  const topPick = players[0];
  const top3 = players.slice(0, 3).map(p => p.number);
  const confidence = calculateConfidence(players);
  const reasoning = generateInsights(players);

  return {
    raceId: generateRaceId(date, race.placeCd, race.raceNo),
    venue: race.placeName,
    venueCode: race.placeCd,
    raceNumber: race.raceNo,
    startTime: race.startTime || '未定',
    prediction: {
      topPick: topPick.number,
      top3: top3,
      confidence: confidence,
      players: players,
      reasoning: reasoning,
    },
    result: {
      finished: false,
      rank1: null,
      rank2: null,
      rank3: null,
      updatedAt: null,
    },
    accuracy: {
      topPickHit: null,
      top3Hit: null,
      top3Included: null,
    },
  };
}

// メイン処理
async function main() {
  try {
    console.log('🚀 AI予想生成を開始します...');

    // data/races.json を読み込み
    const racesPath = path.join(__dirname, '..', 'data', 'races.json');
    console.log(`📖 レースデータを読み込み中: ${racesPath}`);

    const racesData = JSON.parse(await fs.readFile(racesPath, 'utf-8'));

    if (!racesData.success || !racesData.data) {
      throw new Error('races.json に有効なデータがありません');
    }

    console.log(`✅ ${racesData.data.length}会場のデータを取得しました`);

    // 今日の日付を取得
    const today = getTodayDateJST();
    console.log(`📅 予想生成日: ${today}`);

    // 全レースの予想を生成
    const allPredictions = [];
    let totalRaces = 0;

    for (const venue of racesData.data) {
      console.log(`\n📍 ${venue.placeName} (${venue.placeCd})`);

      if (!venue.races || venue.races.length === 0) {
        console.log('  ⚠️  レースデータなし');
        continue;
      }

      for (const race of venue.races) {
        // レースデータに場所情報を追加
        race.placeName = venue.placeName;
        race.placeCd = venue.placeCd;

        const prediction = generateRacePrediction(race, today);

        if (prediction) {
          allPredictions.push(prediction);
          totalRaces++;
          console.log(`  ✅ ${race.raceNo}R - 本命: ${prediction.prediction.topPick}号艇 (信頼度: ${prediction.prediction.confidence}%)`);
        } else {
          console.log(`  ❌ ${race.raceNo}R - 予想生成失敗`);
        }
      }
    }

    console.log(`\n📊 合計 ${totalRaces}レースの予想を生成しました`);

    // data/predictions/ ディレクトリを作成（存在しない場合）
    const predictionsDir = path.join(__dirname, '..', 'data', 'predictions');
    await fs.mkdir(predictionsDir, { recursive: true });

    // data/predictions/YYYY-MM-DD.json に保存
    const outputPath = path.join(predictionsDir, `${today}.json`);
    const outputData = {
      date: today,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      races: allPredictions,
    };

    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
    console.log(`\n💾 予想データを保存しました: ${outputPath}`);
    console.log('✨ 予想生成が完了しました！');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプト実行
main();
