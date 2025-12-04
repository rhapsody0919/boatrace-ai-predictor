/**
 * AI予想生成スクリプト
 *
 * data/races.json から全レースのAI予想を生成し、
 * data/predictions/YYYY-MM-DD.json に保存します。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 選手データからAIスコアを計算
 */
function calculateAIScore(racer, index) {
  return Math.floor(
    racer.globalWinRate * 100 +
    racer.local2Rate * 50 +
    racer.motor2Rate * 30 +
    racer.boat2Rate * 20 -
    index * 5
  )
}

/**
 * レースの選手データを生成
 */
function generatePlayers(racers) {
  if (!racers || racers.length === 0) {
    console.warn('⚠️  選手データがありません。ダミーデータを使用します。')
    const names = ['山田太郎', '鈴木次郎', '佐藤三郎', '田中四郎', '伊藤五郎', '渡辺六郎']
    return names.map((name, idx) => ({
      number: idx + 1,
      name: name,
      grade: 'B1',
      age: 25 + Math.floor(Math.random() * 20),
      winRate: (Math.random() * 0.3 + 5.0).toFixed(2),
      localWinRate: (Math.random() * 0.3 + 5.0).toFixed(2),
      motorNumber: Math.floor(Math.random() * 100) + 1,
      motor2Rate: (Math.random() * 20 + 30).toFixed(1),
      boatNumber: Math.floor(Math.random() * 100) + 1,
      boat2Rate: (Math.random() * 20 + 30).toFixed(1),
      aiScore: Math.floor(Math.random() * 40) + 60 - idx * 8,
    })).sort((a, b) => b.aiScore - a.aiScore)
  }

  // 実データを使用
  return racers.map((racer, idx) => ({
    number: racer.lane,
    name: racer.name,
    grade: racer.grade,
    age: racer.age,
    winRate: racer.globalWinRate.toFixed(2),
    localWinRate: racer.localWinRate.toFixed(2),
    motorNumber: racer.motorNumber,
    motor2Rate: racer.motor2Rate.toFixed(1),
    boatNumber: racer.boatNumber,
    boat2Rate: racer.boat2Rate.toFixed(1),
    aiScore: calculateAIScore(racer, idx),
  })).sort((a, b) => b.aiScore - a.aiScore)
}

/**
 * 統計的な注目ポイントを生成
 */
function generateInsights(players) {
  const insights = []

  // 当地勝率が最も高い選手
  const topLocalWinRate = [...players].sort((a, b) =>
    parseFloat(b.localWinRate) - parseFloat(a.localWinRate)
  )[0]

  if (topLocalWinRate && parseFloat(topLocalWinRate.localWinRate) > 0) {
    insights.push(
      `${topLocalWinRate.number}号艇の${topLocalWinRate.name}選手は` +
      `当レース場での勝率が${topLocalWinRate.localWinRate}と最も高い`
    )
  }

  // モーター2率が40%以上の選手
  const goodMotors = players.filter(p => parseFloat(p.motor2Rate) > 40)
  if (goodMotors.length > 0) {
    const motorList = goodMotors.map(p =>
      `${p.number}号艇（${p.motor2Rate}%）`
    ).join('、')
    insights.push(
      `${motorList}のモーターは2連率が高く好調`
    )
  }

  // 全国勝率が7.0以上の選手
  const topRacers = players.filter(p => parseFloat(p.winRate) >= 7.0)
  if (topRacers.length > 0) {
    const racerList = topRacers.map(p =>
      `${p.number}号艇（勝率${p.winRate}）`
    ).join('、')
    insights.push(
      `${racerList}は全国勝率が高い実力者`
    )
  }

  // 級別がA1の選手
  const a1Racers = players.filter(p => p.grade === 'A1')
  if (a1Racers.length > 0) {
    const racerList = a1Racers.map(p =>
      `${p.number}号艇（${p.name}）`
    ).join('、')
    insights.push(
      `${racerList}はA1級の最高位選手`
    )
  }

  return insights
}

/**
 * 1レースの予想を生成
 */
function generateRacePrediction(race, venueCode, venueName) {
  const players = generatePlayers(race.racers)
  const insights = generateInsights(players)

  const topPick = players[0]
  const top3 = players.slice(0, 3)

  // AIの信頼度を計算（トップとの差が大きいほど高い）
  const scoreDiff = topPick.aiScore - players[1].aiScore
  const confidence = Math.min(95, Math.max(65, 70 + scoreDiff / 2))

  return {
    raceId: `${race.date}-${String(venueCode).padStart(2, '0')}-${String(race.raceNo).padStart(2, '0')}`,
    venue: venueName,
    venueCode: venueCode,
    raceNumber: race.raceNo,
    startTime: race.startTime || '未定',
    prediction: {
      topPick: topPick.number,
      top3: top3.map(p => p.number),
      confidence: Math.floor(confidence),
      players: players,
      reasoning: insights.length > 0 ? insights : [
        '選手データを総合的に分析しました',
        'AIスコアに基づいた予想です'
      ]
    },
    result: {
      finished: false,
      rank1: null,
      rank2: null,
      rank3: null,
      updatedAt: null
    },
    accuracy: {
      topPickHit: null,
      top3Hit: null,
      top3Included: null
    }
  }
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('🚀 AI予想生成を開始します...')

    // data/races.json を読み込み
    const racesPath = path.join(__dirname, '..', 'data', 'races.json')

    if (!fs.existsSync(racesPath)) {
      throw new Error(`races.json が見つかりません: ${racesPath}`)
    }

    const racesData = JSON.parse(fs.readFileSync(racesPath, 'utf-8'))

    if (!racesData.success || !racesData.data) {
      throw new Error('races.json の形式が不正です')
    }

    console.log(`📊 ${racesData.data.length}会場のデータを読み込みました`)

    // 日本時間で今日の日付を取得
    const now = new Date()
    const jstOffset = 9 * 60 // JST is UTC+9
    const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000)
    const dateStr = jstDate.toISOString().split('T')[0]

    console.log(`📅 生成日: ${dateStr}`)

    // 全レースの予想を生成
    const allRaces = []
    let totalRaces = 0

    for (const venue of racesData.data) {
      const venueCode = venue.placeCd
      const venueName = venue.placeName

      if (!venue.races || venue.races.length === 0) {
        console.log(`⏭️  ${venueName}: レースがありません`)
        continue
      }

      console.log(`🏁 ${venueName}: ${venue.races.length}レースを処理中...`)

      for (const race of venue.races) {
        const racePrediction = generateRacePrediction(race, venueCode, venueName)
        allRaces.push(racePrediction)
        totalRaces++
      }
    }

    console.log(`✅ 合計 ${totalRaces}レースの予想を生成しました`)

    // data/predictions ディレクトリを作成
    const predictionsDir = path.join(__dirname, '..', 'data', 'predictions')
    if (!fs.existsSync(predictionsDir)) {
      fs.mkdirSync(predictionsDir, { recursive: true })
      console.log(`📁 ${predictionsDir} を作成しました`)
    }

    // JSONファイルに保存
    const outputPath = path.join(predictionsDir, `${dateStr}.json`)
    const output = {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      races: allRaces
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
    console.log(`💾 ${outputPath} に保存しました`)

    // 統計情報を表示
    console.log('\n📈 統計情報:')
    console.log(`  - 生成日: ${dateStr}`)
    console.log(`  - 会場数: ${racesData.data.length}`)
    console.log(`  - レース数: ${totalRaces}`)
    console.log(`  - 平均信頼度: ${Math.floor(allRaces.reduce((sum, r) => sum + r.prediction.confidence, 0) / totalRaces)}%`)

    console.log('\n✨ AI予想生成が完了しました！')

  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// スクリプト実行
main()
