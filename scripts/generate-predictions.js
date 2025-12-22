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

// 標準偏差を計算
function calculateStdDev(values) {
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squareDiffs = values.map(val => Math.pow(val - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

// 荒れ度スコアを計算（0-100、高いほど荒れやすい）
// reasonsを含むオブジェクトを返す
function calculateVolatilityScore(racers, placeCd) {
  if (!racers || racers.length < 6) {
    return {
      score: 50,
      reasons: ['選手データが不足しています']
    };
  }

  let volatility = 0;
  const reasons = [];

  // 1. 実力差の小ささ（最重要）- 拮抗しているほど荒れる
  const winRates = racers.map(r => r.globalWinRate);
  const winRateStdDev = calculateStdDev(winRates);
  const avgWinRate = winRates.reduce((sum, rate) => sum + rate, 0) / winRates.length;
  const powerBalanceScore = Math.max(0, (1.5 - winRateStdDev) * 20);

  if (powerBalanceScore > 10) {
    volatility += powerBalanceScore;
    reasons.push(`選手間の実力差が小さい（勝率の標準偏差: ${winRateStdDev.toFixed(2)}%、平均: ${avgWinRate.toFixed(1)}%）`);
  }

  // 2. 1号艇の強さ（逆相関）- 1号艇が弱いほど荒れる
  const lane1 = racers[0];
  let lane1Weakness = 0;
  const lane1Factors = [];

  if (lane1.grade !== 'A1') {
    lane1Weakness += 20;
    lane1Factors.push(`グレード: ${lane1.grade}`);
  }
  if (lane1.globalWinRate < 6.0) {
    lane1Weakness += 15;
    lane1Factors.push(`勝率: ${lane1.globalWinRate.toFixed(1)}%`);
  }
  if (lane1.globalWinRate < 5.5) {
    lane1Weakness += 10;
  }

  if (lane1Weakness > 0) {
    volatility += lane1Weakness;
    const avgWinRate = winRates.reduce((sum, r) => sum + r, 0) / winRates.length;
    const diff = ((avgWinRate - lane1.globalWinRate) / avgWinRate * 100).toFixed(0);
    reasons.push(`1号艇が平均より${diff}%弱い（${lane1Factors.join('、')}）`);
  }

  // 3. モーター性能の均等さ - 均等なほど荒れる
  const motorRates = racers.map(r => r.motor2Rate);
  const motorStdDev = calculateStdDev(motorRates);
  const motorBalanceScore = Math.max(0, (15 - motorStdDev) * 1.5);

  if (motorBalanceScore > 5 && motorStdDev < 12) {
    volatility += motorBalanceScore;
    reasons.push(`モーター性能が均等（2連率の標準偏差: ${motorStdDev.toFixed(1)}%）`);
  }

  // 4. 外枠の好機材 - 外枠に良いモーターがあると荒れる
  const outsideGoodMotors = racers.slice(3).filter(r => r.motor2Rate > 40).length;
  if (outsideGoodMotors > 0) {
    volatility += outsideGoodMotors * 8;
    const motorNumbers = racers.slice(3)
      .map((r, index) => ({ ...r, boatNumber: index + 4 }))
      .filter(r => r.motor2Rate > 40)
      .map(r => `${r.boatNumber}号艇(${r.motor2Rate.toFixed(1)}%)`)
      .join('、');
    reasons.push(`外枠に好機材が${outsideGoodMotors}艇（${motorNumbers}）`);
  }

  // 5. 競艇場特性（荒れやすい場）
  // 戸田(02)、江戸川(03)、平和島(04)は荒れやすい
  const roughVenues = {
    '02': '戸田',
    '03': '江戸川',
    '04': '平和島'
  };
  const venueCode = String(placeCd).padStart(2, '0');
  if (roughVenues[venueCode]) {
    volatility += 12;
    reasons.push(`${roughVenues[venueCode]}は荒れやすい競艇場`);
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(volatility)));

  // スコアに応じた総評を追加
  if (reasons.length === 0) {
    if (finalScore < 35) {
      reasons.push('1号艇が安定して有利な展開');
    } else {
      reasons.push('標準的なレース展開');
    }
  }

  return {
    score: finalScore,
    reasons: reasons
  };
}

// 荒れ度レベルを判定
function getVolatilityLevel(score) {
  if (score < 35) return 'low';    // 堅い
  if (score < 65) return 'medium'; // 標準
  return 'high';                    // 荒れる
}

// 推奨モデルを判定
function getRecommendedModel(score) {
  if (score < 35) return 'safe-bet';      // 本命狙い
  if (score < 65) return 'standard';      // スタンダード
  return 'upset-focus';                   // 穴狙い
}

// スタンダード版AIスコア（従来のロジック）
function calculateStandardScore(racer, index) {
  return Math.floor(
    racer.globalWinRate * 100 +
    racer.local2Rate * 50 +
    racer.motor2Rate * 30 +
    racer.boat2Rate * 20 -
    index * 5
  );
}

// スタンダードv2版AIスコア（統計的に最適化）
// 統計分析（2,172レース）に基づく係数:
// - 枠番の影響: 22倍差（最重要）
// - 全国勝率の影響: 10倍差（非常に重要）
// - 級別の影響: 5倍差（重要）
// - モーター性能: 5.2%差（限定的）
// - 当地成績: 3.7%差（限定的）
function calculateStandardScoreV2(racer, index) {
  let score = 0;

  // 全国勝率（最重要: 10倍の差がある）
  score += racer.globalWinRate * 150;

  // 級別ボーナス（非常に重要: A1はB2の5倍勝ちやすい）
  if (racer.grade === 'A1') score += 400;
  else if (racer.grade === 'A2') score += 250;
  else if (racer.grade === 'B1') score += 100;
  else if (racer.grade === 'B2') score += 0;

  // 枠番補正（圧倒的に重要: 1号艇は6号艇の22倍勝ちやすい）
  if (index === 0) score += 500;      // 1号艇
  else if (index === 1) score += 100; // 2号艇
  else if (index === 2) score += 0;   // 3号艇
  else if (index === 3) score -= 50;  // 4号艇
  else if (index === 4) score -= 100; // 5号艇
  else if (index === 5) score -= 150; // 6号艇

  // モーター性能（限定的: 5.2%の差）
  score += racer.motor2Rate * 20;

  // ボート性能（限定的: データ不足）
  score += racer.boat2Rate * 10;

  // 当地アドバンテージ（限定的: 3.7%の差）
  const localAdvantage = racer.localWinRate - racer.globalWinRate;
  score += localAdvantage * 10;

  return Math.floor(score);
}

// 本命狙い版スコア（堅実型）
function calculateSafeBetScore(racer, index) {
  let score = 0;

  // 1号艇に大きなボーナス
  if (index === 0) score += 150;

  // A1級に大きなボーナス
  if (racer.grade === 'A1') score += 120;
  else if (racer.grade === 'A2') score += 60;

  // 全国勝率を重視
  score += racer.globalWinRate * 130;

  // 当地勝率
  score += racer.localWinRate * 80;

  // モーター性能（やや控えめ）
  score += racer.motor2Rate * 40;

  // レーン位置ペナルティ（強め）
  score -= index * 15;

  return Math.floor(score);
}

// 穴狙い版スコア（高配当型）
function calculateUpsetFocusScore(racer, index) {
  let score = 0;

  // 外枠の逆転要素を重視
  if (index >= 3) score += 100; // 4-6号艇にボーナス

  // モーター性能を最重視（機材で逆転）
  score += racer.motor2Rate * 180;

  // ボート性能
  score += racer.boat2Rate * 80;

  // 当地適性（地元の利）
  score += racer.localWinRate * 100;
  score += racer.local2Rate * 60;

  // 全国勝率（やや控えめ）
  score += racer.globalWinRate * 50;

  // 1号艇へのペナルティ（逆張り）
  if (index === 0) score -= 100;

  return Math.floor(score);
}

// 選手データを処理（特定のスコア計算関数を使用）
function processRacersWithScoreFn(racers, scoreFn) {
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
    aiScore: scoreFn(racer, idx),
  }));

  // AIスコア順にソート
  return players.sort((a, b) => b.aiScore - a.aiScore);
}

// 後方互換性のため（従来のprocessRacers）
function processRacers(racers) {
  return processRacersWithScoreFn(racers, calculateStandardScoreV2);
}

// 本命選手の選定理由を生成
function generateTopPickReasoning(topPickPlayer, players, modelType) {
  const reasons = [];
  const number = topPickPlayer.number;
  const winRate = parseFloat(topPickPlayer.winRate);
  const localWinRate = parseFloat(topPickPlayer.localWinRate);
  const motor2Rate = parseFloat(topPickPlayer.motor2Rate);

  if (modelType === 'standard') {
    // スタンダード：バランス重視
    reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

    const strengths = [];
    if (winRate >= 6.5) {
      strengths.push(`全国勝率${topPickPlayer.winRate}の実力者`);
    }
    if (localWinRate >= 5.5) {
      strengths.push(`当地成績${topPickPlayer.localWinRate}と好相性`);
    }
    if (motor2Rate >= 35) {
      strengths.push(`モーター2連率${topPickPlayer.motor2Rate}%の${motor2Rate >= 40 ? '好' : '安定'}機材`);
    }

    if (strengths.length > 0) {
      reasons.push(strengths.join('、') + 'で総合評価が最高');
    } else {
      reasons.push('総合的なデータ分析により最高評価を獲得');
    }

  } else if (modelType === 'safe-bet') {
    // 本命狙い：安全性重視
    reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

    const strengths = [];
    if (number === 1) {
      strengths.push('1号艇の有利なコース取り');
    }
    if (topPickPlayer.grade === 'A1') {
      strengths.push('A1級選手として安定した実力');
    } else if (topPickPlayer.grade === 'A2') {
      strengths.push('A2級選手として堅実な実績');
    }
    if (winRate >= 6.0) {
      strengths.push(`全国勝率${topPickPlayer.winRate}の高い実力`);
    }

    if (strengths.length > 0) {
      reasons.push(strengths.join('、') + 'により的中率が期待できる');
    } else {
      reasons.push('安全性を重視した評価で最高スコアを獲得');
    }

  } else if (modelType === 'upset-focus') {
    // 穴狙い：高配当重視
    reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

    const strengths = [];
    if (number >= 4 && motor2Rate >= 38) {
      strengths.push(`${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の好機材`);
    }
    if (localWinRate >= 5.5) {
      strengths.push(`当地成績${topPickPlayer.localWinRate}で展開に期待`);
    }
    if (motor2Rate >= 40) {
      strengths.push('好モーターを活かした高配当の可能性');
    }

    if (strengths.length > 0) {
      reasons.push(strengths.join('、'));
    } else {
      reasons.push('展開の妙と機材性能を重視した評価で最高スコア');
    }
  }

  return reasons;
}

// 統計的な注目ポイントを生成（参考情報）
function generateStatisticalInsights(players) {
  const insights = [];

  // モーター2率が40%以上の選手
  const goodMotors = players.filter(p => parseFloat(p.motor2Rate) > 40);
  if (goodMotors.length > 0) {
    const motorList = goodMotors.map(p =>
      `${p.number}号艇（${p.motor2Rate}%）`
    ).join('、');
    insights.push(
      `好モーター: ${motorList}`
    );
  }

  // 全国勝率が7.0以上の選手
  const topRacers = players.filter(p => parseFloat(p.winRate) >= 7.0);
  if (topRacers.length > 0) {
    const racerList = topRacers.map(p =>
      `${p.number}号艇（勝率${p.winRate}）`
    ).join('、');
    insights.push(
      `実力者: ${racerList}`
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

// 1レース分の予想を生成（3モデル対応）
function generateRacePrediction(race, date) {
  if (!race.racers || race.racers.length === 0) {
    console.warn(`⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`);
    return null;
  }

  // 荒れ度スコアを計算
  const volatilityData = calculateVolatilityScore(race.racers, race.placeCd);
  const volatilityLevel = getVolatilityLevel(volatilityData.score);
  const recommendedModel = getRecommendedModel(volatilityData.score);

  // 3つのモデルで予想を生成
  const standardPlayers = processRacersWithScoreFn(race.racers, calculateStandardScoreV2);
  const safeBetPlayers = processRacersWithScoreFn(race.racers, calculateSafeBetScore);
  const upsetFocusPlayers = processRacersWithScoreFn(race.racers, calculateUpsetFocusScore);

  if (standardPlayers.length === 0) {
    console.warn(`⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`);
    return null;
  }

  // スタンダード版の予想
  const standardTop3 = standardPlayers.slice(0, 3).map(p => p.number);
  const standardConfidence = calculateConfidence(standardPlayers);
  const standardReasoning = generateTopPickReasoning(standardPlayers[0], standardPlayers, 'standard');

  // 本命狙い版の予想
  const safeBetTop3 = safeBetPlayers.slice(0, 3).map(p => p.number);
  const safeBetConfidence = calculateConfidence(safeBetPlayers);
  const safeBetReasoning = generateTopPickReasoning(safeBetPlayers[0], safeBetPlayers, 'safe-bet');

  // 穴狙い版の予想
  const upsetFocusTop3 = upsetFocusPlayers.slice(0, 3).map(p => p.number);
  const upsetFocusConfidence = calculateConfidence(upsetFocusPlayers);
  const upsetFocusReasoning = generateTopPickReasoning(upsetFocusPlayers[0], upsetFocusPlayers, 'upset-focus');

  return {
    raceId: generateRaceId(date, race.placeCd, race.raceNo),
    venue: race.placeName,
    venueCode: race.placeCd,
    raceNumber: race.raceNo,
    startTime: race.startTime || '未定',

    // 荒れ度情報
    volatility: {
      score: volatilityData.score,
      level: volatilityLevel,
      recommendedModel: recommendedModel,
      reasons: volatilityData.reasons,
    },

    // 3モデルの予想
    predictions: {
      standard: {
        topPick: standardPlayers[0].number,
        top3: standardTop3,
        confidence: standardConfidence,
        players: standardPlayers,
        reasoning: standardReasoning,
      },
      safeBet: {
        topPick: safeBetPlayers[0].number,
        top3: safeBetTop3,
        confidence: safeBetConfidence,
        players: safeBetPlayers,
        reasoning: safeBetReasoning,
      },
      upsetFocus: {
        topPick: upsetFocusPlayers[0].number,
        top3: upsetFocusTop3,
        confidence: upsetFocusConfidence,
        players: upsetFocusPlayers,
        reasoning: upsetFocusReasoning,
      },
    },

    // 後方互換性のため（既存のpredictionフィールドを維持）
    prediction: {
      topPick: standardPlayers[0].number,
      top3: standardTop3,
      confidence: standardConfidence,
      players: standardPlayers,
      reasoning: standardReasoning,
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
