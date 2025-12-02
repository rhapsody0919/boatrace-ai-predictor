import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [selectedRace, setSelectedRace] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isRealData, setIsRealData] = useState(false)
  const [allVenuesData, setAllVenuesData] = useState([])
  const [selectedVenueId, setSelectedVenueId] = useState(null)
  const [races, setRaces] = useState([])
  const predictionRef = useRef(null)

  // レース場番号から名前へのマッピング
  const stadiumNames = {
    1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
    7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
    13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
    19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
  }

  // 実際のAPIからデータを取得
  useEffect(() => {
    const fetchRaceData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 静的JSONファイルから読み込み（GitHub Pages対応）
        // ローカル開発時はpublic/data/races.json、本番はビルド後のdata/races.jsonから読み込み
        const apiUrl = import.meta.env.BASE_URL + 'data/races.json'

        const response = await fetch(apiUrl)

        if (!response.ok) {
          throw new Error('スクレイピングAPIからデータを取得できませんでした')
        }

        const result = await response.json()

        if (!result.success || !result.data) {
          throw new Error('有効なデータが取得できませんでした')
        }

        // レース場データを保存
        console.log('📊 取得したデータ:', result.data)
        console.log('📊 最初の会場のレース:', result.data[0]?.races)
        console.log('📊 最初のレースのracers:', result.data[0]?.races[0]?.racers)
        setAllVenuesData(result.data)
        setIsRealData(true)

        // 最初に開催されているレース場を自動選択
        if (result.data.length > 0) {
          setSelectedVenueId(result.data[0].placeCd)
        }

      } catch (err) {
        console.error('API取得エラー:', err)
        setError(err.message)
        setIsRealData(false)
      } finally {
        setLoading(false)
      }
    }

    fetchRaceData()
  }, [])

  // レース場選択時にレース一覧を更新
  useEffect(() => {
    if (selectedVenueId && allVenuesData.length > 0) {
      const venueData = allVenuesData.find(v => v.placeCd === selectedVenueId)

      if (venueData && venueData.races) {
        // レースデータを表示用に変換
        const formattedRaces = venueData.races.map(race => {
          return {
            id: `${race.date}-${race.placeCd}-${race.raceNo}`,
            venue: venueData.placeName,
            raceNumber: race.raceNo,
            startTime: race.startTime || '未定', // スクレイピングした締切予定時刻を使用
            weather: race.weather || '不明',
            wave: race.waveHeight || 0,
            wind: race.windVelocity || 0,
            rawData: race // 元のデータも保持
          }
        })

        setRaces(formattedRaces)
      } else {
        setRaces([])
      }
    }
  }, [selectedVenueId, allVenuesData])

  // AI予想が完了したら自動的にスクロール
  useEffect(() => {
    if (prediction && !isAnalyzing && predictionRef.current) {
      predictionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }
  }, [prediction, isAnalyzing])

  const analyzeRace = (race) => {
    setSelectedRace(race)
    setIsAnalyzing(true)
    setPrediction(null)

    // AIによる予想をシミュレート
    setTimeout(() => {
      const players = generatePlayers(race)  // raceを直接渡す
      const aiPrediction = {
        topPick: players[0],
        recommended: players.slice(0, 3),
        allPlayers: players,
        confidence: Math.floor(Math.random() * 30) + 70,
        reasoning: [
          '過去10レースの勝率が高い',
          'モーター成績が優秀',
          '当該コースでの実績あり',
          '気象条件が有利',
        ]
      }
      setPrediction(aiPrediction)
      setIsAnalyzing(false)
    }, 2000)
  }

  const generatePlayers = (race) => {
    // 実データから選手情報を取得
    // raceはフォーマット済みオブジェクトで、実データはrawDataに格納されている
    console.log('🔍 race:', race)
    console.log('🔍 race.rawData:', race?.rawData)
    console.log('🔍 race.rawData.racers:', race?.rawData?.racers)

    const racers = race?.rawData?.racers

    if (!racers || racers.length === 0) {
      console.log('⚠️ racers データがありません。ダミーデータを使用します。')
      // データがない場合はダミーデータを返す
      const names = ['山田太郎', '鈴木次郎', '佐藤三郎', '田中四郎', '伊藤五郎', '渡辺六郎']
      return names.map((name, idx) => ({
        number: idx + 1,
        name: name,
        age: 25 + Math.floor(Math.random() * 20),
        winRate: (Math.random() * 0.3 + 0.2).toFixed(3),
        motorNumber: Math.floor(Math.random() * 100) + 1,
        motorWinRate: (Math.random() * 0.2 + 0.3).toFixed(3),
        aiScore: Math.floor(Math.random() * 40) + 60 - idx * 8,
      })).sort((a, b) => b.aiScore - a.aiScore)
    }

    // 実データを使用
    return racers.map((racer, idx) => ({
      number: racer.lane,
      name: racer.name,
      grade: racer.grade,
      age: racer.age,
      winRate: racer.globalWinRate.toFixed(3),
      localWinRate: racer.localWinRate.toFixed(3),
      motorNumber: racer.motorNumber,
      motor2Rate: racer.motor2Rate.toFixed(1),
      motorWinRate: racer.motor2Rate.toFixed(1), // 互換性のため
      boatNumber: racer.boatNumber,
      boat2Rate: racer.boat2Rate.toFixed(1),
      // AIスコアは勝率などから簡易計算（実際のAIは後で実装）
      aiScore: Math.floor(
        racer.globalWinRate * 100 +
        racer.local2Rate * 50 +
        racer.motor2Rate * 30 +
        racer.boat2Rate * 20 -
        idx * 5
      ),
    })).sort((a, b) => b.aiScore - a.aiScore)
  }

  // 統計的な注目ポイントを自動生成
  const generateInsights = (players) => {
    const insights = []

    // 当地勝率が最も高い選手
    const topLocalWinRate = [...players].sort((a, b) =>
      parseFloat(b.localWinRate) - parseFloat(a.localWinRate)
    )[0]

    if (topLocalWinRate) {
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

    return insights
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="logo">
            <span className="logo-icon">🚤</span>
            <h1>ボートレースAI予想</h1>
          </div>
          <nav className="nav">
            <button className="nav-btn active">今日のレース</button>
            <button className="nav-btn">予想履歴</button>
            <button className="nav-btn">統計</button>
          </nav>
        </div>
      </header>

      <div className="container">
        <main className="main-content">
          <section className="race-list-section">
            <h2>🏁 本日開催中のレース {isRealData && <span style={{fontSize: '0.8rem', color: '#22c55e', marginLeft: '1rem'}}>✓ 実データ</span>}</h2>

            {loading ? (
              <div className="analyzing">
                <div className="spinner"></div>
                <p>レースデータを読み込み中...</p>
              </div>
            ) : (
              <>
                {error && (
                  <div style={{padding: '1rem', background: '#fff3cd', borderRadius: '8px', marginBottom: '1rem'}}>
                    <p style={{color: '#856404'}}>⚠️ {error}</p>
                    <p style={{color: '#856404', fontSize: '0.9rem'}}>データ取得に失敗しました</p>
                  </div>
                )}

                {/* レース場選択ドロップダウン */}
                {allVenuesData.length > 0 && (
                  <div style={{marginBottom: '1.5rem'}}>
                    <label htmlFor="venue-select" style={{
                      display: 'block',
                      marginBottom: '0.5rem',
                      fontWeight: 'bold',
                      color: '#334155'
                    }}>
                      レース場を選択:
                    </label>
                    <select
                      id="venue-select"
                      value={selectedVenueId || ''}
                      onChange={(e) => setSelectedVenueId(parseInt(e.target.value))}
                      style={{
                        padding: '0.75rem 1rem',
                        fontSize: '1rem',
                        borderRadius: '8px',
                        border: '2px solid #e2e8f0',
                        backgroundColor: 'white',
                        color: '#1e293b',
                        cursor: 'pointer',
                        minWidth: '250px',
                        outline: 'none'
                      }}
                    >
                      {allVenuesData.map(venue => (
                        <option key={venue.placeCd} value={venue.placeCd}>
                          {venue.placeName} ({venue.races.length}レース)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {races.length === 0 && !error ? (
                  <div style={{padding: '2rem', textAlign: 'center', color: '#64748b'}}>
                    <p>本日、このレース場での開催はありません</p>
                  </div>
                ) : (
                  <div className="race-grid">
                    {races.map(race => (
                      <div key={race.id} className="race-card">
                        <div className="race-card-header">
                          <h3>{race.venue}</h3>
                          <span className="race-number">{race.raceNumber}R</span>
                        </div>
                        <div className="race-info">
                          <div className="info-item">
                            <span className="label">締切予定時刻</span>
                            <span className="value">{race.startTime}</span>
                          </div>
                        </div>
                        <button
                          className="predict-btn"
                          onClick={() => analyzeRace(race)}
                        >
                          AI予想を見る
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {selectedRace && (
            <section ref={predictionRef} className="prediction-section">
              <h2>📊 AI予想結果 - {selectedRace.venue} {selectedRace.raceNumber}R</h2>

              {isAnalyzing ? (
                <div className="analyzing">
                  <div className="spinner"></div>
                  <p>AIが分析中...</p>
                  <p className="analyzing-detail">過去データ、モーター性能、気象条件を解析しています</p>
                </div>
              ) : prediction && (
                <div className="prediction-result">
                  <div className="confidence-bar">
                    <div className="confidence-label">
                      AI信頼度: <strong>{prediction.confidence}%</strong>
                    </div>
                    <div className="bar">
                      <div
                        className="bar-fill"
                        style={{ width: `${prediction.confidence}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="top-pick">
                    <h3>🥇 本命予想</h3>
                    <div className="player-card featured">
                      <div className="player-number">{prediction.topPick.number}</div>
                      <div className="player-details">
                        <h4>{prediction.topPick.name}</h4>
                        <div className="stats">
                          <span>級別: {prediction.topPick.grade}</span>
                          <span>年齢: {prediction.topPick.age}歳</span>
                          <span>勝率: {prediction.topPick.winRate}</span>
                          <span>モーター: {prediction.topPick.motorNumber} ({prediction.topPick.motor2Rate}%)</span>
                        </div>
                      </div>
                      <div className="ai-score">
                        <div className="score-label">AIスコア</div>
                        <div className="score-value">{prediction.topPick.aiScore}</div>
                      </div>
                    </div>
                  </div>

                  <div className="reasoning">
                    <h4>📌 予想根拠</h4>
                    <ul>
                      {prediction.reasoning.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="all-players">
                    <h4>全艇情報</h4>
                    <table className="players-table">
                      <thead>
                        <tr>
                          <th>艇番</th>
                          <th>選手名</th>
                          <th>級別</th>
                          <th>年齢</th>
                          <th>勝率</th>
                          <th>モーター</th>
                          <th>AIスコア</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prediction.allPlayers.map(player => (
                          <tr key={player.number} className={player.number <= 3 ? 'recommended' : ''}>
                            <td><strong>{player.number}</strong></td>
                            <td>{player.name}</td>
                            <td>{player.grade}</td>
                            <td>{player.age}歳</td>
                            <td>{player.winRate}</td>
                            <td>{player.motorNumber} ({player.motor2Rate}%)</td>
                            <td><span className="score-badge">{player.aiScore}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 詳細データ分析セクション（新規追加） */}
                  <div className="detailed-analysis">
                    <h3>📊 詳細データ分析</h3>

                    {/* 強化されたテーブル */}
                    <div className="enhanced-table">
                      <table className="players-table-detailed">
                        <thead>
                          <tr>
                            <th>艇番</th>
                            <th>選手名</th>
                            <th>級別</th>
                            <th>全国勝率</th>
                            <th>当地勝率</th>
                            <th>モーター番号</th>
                            <th>モーター2率</th>
                            <th>ボート番号</th>
                            <th>ボート2率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prediction.allPlayers.map(player => (
                            <tr key={player.number}>
                              <td><strong>{player.number}</strong></td>
                              <td>{player.name}</td>
                              <td>{player.grade}</td>
                              <td>{player.winRate}</td>
                              <td>
                                {player.localWinRate}
                                {parseFloat(player.localWinRate) > 7.0 && <span className="fire">🔥</span>}
                              </td>
                              <td>{player.motorNumber}</td>
                              <td>
                                {player.motor2Rate}%
                                {parseFloat(player.motor2Rate) > 40 && <span className="fire">🔥</span>}
                              </td>
                              <td>{player.boatNumber}</td>
                              <td>{player.boat2Rate}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* 統計的な注目ポイント */}
                    <div className="statistical-insights">
                      <h4>📌 統計的な注目ポイント</h4>
                      <ul>
                        {generateInsights(prediction.allPlayers).map((insight, idx) => (
                          <li key={idx}>{insight}</li>
                        ))}
                      </ul>
                    </div>

                    {/* データの見方（解説） */}
                    <div className="data-guide">
                      <h4>💡 データの見方</h4>
                      <div className="guide-grid">
                        <div className="guide-item">
                          <strong>全国勝率</strong>
                          <p>選手の全国での勝率。6.0以上でA級レベル。</p>
                        </div>
                        <div className="guide-item">
                          <strong>当地勝率</strong>
                          <p>このレース場での勝率。得意度を示す。</p>
                        </div>
                        <div className="guide-item">
                          <strong>モーター2率</strong>
                          <p>モーターの2連率。40%以上なら好機。</p>
                        </div>
                        <div className="guide-item">
                          <strong>🔥マーク</strong>
                          <p>特に優れた数値（平均より大きく上回る）。</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      <footer className="footer">
        <p>※本サイトはAIによる予想を提供するものであり、的中を保証するものではありません</p>
        <p>&copy; 2025 ボートレースAI予想 - All Rights Reserved</p>
      </footer>
    </div>
  )
}

export default App
