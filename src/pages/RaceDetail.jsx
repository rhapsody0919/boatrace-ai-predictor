import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Header from '../components/Header'
import Breadcrumb from '../components/Breadcrumb'
import './RaceDetail.css'

function RaceDetail() {
  const { date } = useParams()
  const [raceData, setRaceData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [venuesData, setVenuesData] = useState([])
  const [selectedVenueId, setSelectedVenueId] = useState(null)
  const [selectedRace, setSelectedRace] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [selectedModel, setSelectedModel] = useState('standard')
  const [volatility, setVolatility] = useState(null)
  const predictionRef = useRef(null)

  // レース場番号から名前へのマッピング
  const stadiumNames = {
    1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
    7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
    13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
    19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
  }

  // 日付フォーマット関数
  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00+09:00')
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const weekday = weekdays[date.getDay()]
    return `${year}年${month}月${day}日(${weekday})`
  }

  // パーセント表示
  const formatPercent = (rate) => (rate * 100).toFixed(1) + '%'

  // 回収率の色を取得
  const getRecoveryColor = (rate) => {
    if (rate >= 1.0) return '#10b981'
    if (rate >= 0.9) return '#f59e0b'
    return '#ef4444'
  }

  // レースデータを取得
  useEffect(() => {
    const fetchRaceData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(import.meta.env.BASE_URL + `data/predictions/${date}.json`)
        if (!response.ok) {
          throw new Error('データが見つかりません')
        }

        const data = await response.json()
        setRaceData(data)

        // 会場ごとにレースをグループ化
        const venueMap = {}
        data.races?.forEach(race => {
          const venueCode = race.venueCode
          if (!venueMap[venueCode]) {
            venueMap[venueCode] = {
              placeCd: venueCode,
              placeName: race.venue,
              races: []
            }
          }
          venueMap[venueCode].races.push({
            id: race.raceId,
            venue: race.venue,
            raceNumber: race.raceNumber,
            venueCode: race.venueCode,
            rawData: race
          })
        })

        // 会場ごとにレースをソート
        Object.values(venueMap).forEach(venue => {
          venue.races.sort((a, b) => a.raceNumber - b.raceNumber)
        })

        // 会場コード順にソートした配列に変換
        const venues = Object.values(venueMap).sort((a, b) => a.placeCd - b.placeCd)
        setVenuesData(venues)

        // 最初の会場を自動選択
        if (venues.length > 0) {
          setSelectedVenueId(venues[0].placeCd)
        }

      } catch (err) {
        console.error('データ取得エラー:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchRaceData()
  }, [date])

  // モデル切り替え
  const switchModel = (model) => {
    if (!prediction || !prediction.predictions) return

    setSelectedModel(model)

    // 選択されたモデルの予想データに切り替え
    const modelKey = model === 'safe-bet' ? 'safeBet' :
      model === 'upset-focus' ? 'upsetFocus' : 'standard'
    const modelPrediction = prediction.predictions[modelKey]

    if (modelPrediction) {
      const topPickPlayer = modelPrediction.players.find(
        p => p.number === modelPrediction.topPick
      )
      const top3Players = modelPrediction.top3.map(num =>
        modelPrediction.players.find(p => p.number === num)
      )

      setPrediction({
        ...prediction,
        topPick: topPickPlayer,
        recommended: top3Players,
        allPlayers: modelPrediction.players,
        confidence: modelPrediction.confidence,
        reasoning: modelPrediction.reasoning,
        top3: modelPrediction.top3
      })
    }
  }

  // レース分析
  const analyzeRace = (race) => {
    setSelectedRace(race)

    const racePrediction = race.rawData
    if (!racePrediction || !racePrediction.predictions) {
      setPrediction({
        error: true,
        errorMessage: '予想データがありません'
      })
      return
    }

    // 荒れ度情報を保存
    if (racePrediction.volatility) {
      setVolatility(racePrediction.volatility)
    } else {
      setVolatility(null)
    }

    // 現在選択中のモデルを使用（推奨モデルに自動切り替えしない）
    const modelKey = selectedModel === 'safe-bet' ? 'safeBet' :
      selectedModel === 'upset-focus' ? 'upsetFocus' : 'standard'
    const modelPrediction = racePrediction.predictions[modelKey]

    if (!modelPrediction) {
      setPrediction({
        error: true,
        errorMessage: 'このモデルの予想データがありません'
      })
      return
    }

    const topPickPlayer = modelPrediction.players.find(
      p => p.number === modelPrediction.topPick
    )
    const top3Players = modelPrediction.top3.map(num =>
      modelPrediction.players.find(p => p.number === num)
    )

    setPrediction({
      topPick: topPickPlayer,
      recommended: top3Players,
      allPlayers: modelPrediction.players,
      confidence: modelPrediction.confidence,
      reasoning: modelPrediction.reasoning,
      top3: modelPrediction.top3,
      result: racePrediction.result,
      predictions: racePrediction.predictions
    })

    // スクロール
    setTimeout(() => {
      predictionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }, 100)
  }

  const breadcrumbItems = [
    { label: 'ホーム', path: '/' },
    { label: '過去の予想', path: '/races' },
    { label: formatDate(date), path: `/races/${date}` }
  ]

  // 全モデルの統計を計算
  const getModelComparison = () => {
    if (!raceData || !raceData.races) return null

    const models = ['standard', 'safeBet', 'upsetFocus']
    const modelNames = {
      standard: 'スタンダード',
      safeBet: '本命狙い',
      upsetFocus: '穴狙い'
    }

    return models.map(modelKey => {
      const finishedRaces = raceData.races.filter(r => r.result?.finished)
      let winHits = 0, placeHits = 0, trifecta3Hits = 0, trio3Hits = 0
      let winPayouts = 0, placePayouts = 0, trifecta3Payouts = 0, trio3Payouts = 0

      finishedRaces.forEach(race => {
        const prediction = race.predictions?.[modelKey]
        if (!prediction) return

        const topPick = prediction.topPick
        const top3 = prediction.top3
        const result = race.result

        // 的中判定
        if (topPick === result.rank1) {
          winHits++
          winPayouts += result.payouts?.win?.[topPick] || 0
        }
        if (topPick === result.rank1 || topPick === result.rank2) {
          placeHits++
          placePayouts += result.payouts?.place?.[topPick] || 0
        }
        if (top3.includes(result.rank1) && top3.includes(result.rank2) && top3.includes(result.rank3)) {
          trifecta3Hits++
          // 3連複の配当を計算
          const sorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b)
          const trifectaKey = sorted.join('-')
          trifecta3Payouts += result.payouts?.trifecta?.[trifectaKey] || 0
        }
        if (top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3) {
          trio3Hits++
          // 3連単の配当を計算
          const trioKey = `${result.rank1}-${result.rank2}-${result.rank3}`
          trio3Payouts += result.payouts?.trio?.[trioKey] || 0
        }
      })

      const totalRaces = finishedRaces.length

      return {
        key: modelKey,
        name: modelNames[modelKey],
        races: totalRaces,
        winHitRate: totalRaces > 0 ? winHits / totalRaces : 0,
        winRecoveryRate: totalRaces > 0 ? (winPayouts / 100) / totalRaces : 0,
        placeHitRate: totalRaces > 0 ? placeHits / totalRaces : 0,
        placeRecoveryRate: totalRaces > 0 ? (placePayouts / 100) / totalRaces : 0,
        trifectaHitRate: totalRaces > 0 ? trifecta3Hits / totalRaces : 0,
        trifectaRecoveryRate: totalRaces > 0 ? (trifecta3Payouts / 100) / totalRaces : 0,
        trioHitRate: totalRaces > 0 ? trio3Hits / totalRaces : 0,
        trioRecoveryRate: totalRaces > 0 ? (trio3Payouts / 100) / totalRaces : 0
      }
    })
  }

  const modelComparison = getModelComparison()

  // モデル比較表コンポーネント
  const ModelComparisonTable = () => {
    if (!modelComparison) return null

    return (
      <div className="model-comparison-section">
        <h3>📊 モデル間パフォーマンス比較</h3>
        <div className="table-wrapper">
          <table className="model-comparison-table">
            <thead>
              <tr>
                <th>モデル</th>
                <th>レース数</th>
                <th colSpan="2">単勝</th>
                <th colSpan="2">複勝</th>
                <th colSpan="2">3連複</th>
                <th colSpan="2">3連単</th>
              </tr>
              <tr className="sub-header">
                <th></th>
                <th></th>
                <th className="sub-th">的中率</th>
                <th className="sub-th">回収率</th>
                <th className="sub-th">的中率</th>
                <th className="sub-th">回収率</th>
                <th className="sub-th">的中率</th>
                <th className="sub-th">回収率</th>
                <th className="sub-th">的中率</th>
                <th className="sub-th">回収率</th>
              </tr>
            </thead>
            <tbody>
              {modelComparison.map(model => (
                <tr key={model.key}>
                  <td className="model-name">{model.name}</td>
                  <td className="races-cell">{model.races > 0 ? `${model.races}レース` : '-'}</td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.winHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.winRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.winRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.placeHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.placeRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.placeRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trifectaHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.trifectaRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.trifectaRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trioHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.trioRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.trioRecoveryRate) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <>
      <Helmet>
        <title>{formatDate(date)}のAI予想データ - BoatAI</title>
        <meta name="description" content={`${formatDate(date)}のボートレースAI予想データと的中実績。各レース場の予想結果を確認できます。`} />
        <meta property="og:title" content={`${formatDate(date)}のAI予想データ - BoatAI`} />
        <meta property="og:description" content={`${formatDate(date)}のボートレースAI予想データと的中実績`} />
        <link rel="canonical" href={`https://boat-ai.jp/races/${date}`} />
      </Helmet>

      <Header />

      <div className="race-detail-page">
        <Breadcrumb items={breadcrumbItems} />

      <div className="race-detail-container">
        <header className="page-header">
          <h1>📅 {formatDate(date)}</h1>
          <Link to="/races" className="back-link">← 日付一覧に戻る</Link>
        </header>

        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>データを読み込み中...</p>
          </div>
        ) : error ? (
          <div className="error-container">
            <h3>エラー</h3>
            <p>{error}</p>
            <Link to="/races" className="btn-primary">日付一覧に戻る</Link>
          </div>
        ) : (
          <>
            {/* 統計セクション */}
            <div className="stats-section">
              <ModelComparisonTable />
            </div>

            {/* レース場選択 */}
            {venuesData.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
                marginBottom: '2rem',
                padding: '1.5rem',
                background: 'white',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
              }}>
                <label htmlFor="venue-select" style={{
                  marginBottom: '0',
                  fontWeight: 'bold',
                  fontSize: '1.1rem',
                  color: '#1E293B'
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
                  {venuesData.map(venue => (
                    <option key={venue.placeCd} value={venue.placeCd}>
                      {venue.placeName} ({venue.races.length}レース)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* レース一覧セクション */}
            <section className="race-list-section">
              <h2>🏁 レース一覧</h2>
              <p style={{
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '0.9rem',
                marginBottom: '1.5rem',
                padding: '0.75rem 1rem',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                maxWidth: '600px',
                margin: '0 auto 1.5rem'
              }}>
                ※ 的中バッジは
                <strong style={{
                  color: 'white',
                  margin: '0 0.3rem',
                  padding: '0.2rem 0.5rem',
                  background: selectedModel === 'standard' ? 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' :
                             selectedModel === 'safe-bet' ? 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)' :
                             'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
                  borderRadius: '4px'
                }}>
                  {selectedModel === 'standard' ? 'スタンダード' :
                   selectedModel === 'safe-bet' ? '本命狙い' : '穴狙い'}
                </strong>
                モデルの予想結果です
              </p>

              {(() => {
                const selectedVenue = venuesData.find(v => v.placeCd === selectedVenueId)
                const races = selectedVenue?.races || []

                if (races.length === 0) {
                  return (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
                      <p>このレース場のデータはありません</p>
                    </div>
                  )
                }

                return (
                  <div className="race-grid">
                    {races.map(race => {
                    const racePrediction = race.rawData
                    const result = racePrediction?.result
                    const isFinished = result?.finished

                    // 的中判定（買い方別）
                    let hitBadges = []
                    if (isFinished && racePrediction?.predictions) {
                      // モデルキーを変換
                      const modelKey = selectedModel === 'safe-bet' ? 'safeBet' :
                        selectedModel === 'upset-focus' ? 'upsetFocus' : 'standard'
                      const prediction = racePrediction.predictions[modelKey]

                      if (prediction) {
                        const topPick = prediction.topPick
                        const top3 = prediction.top3

                        const isWinHit = topPick === result.rank1
                        const isPlaceHit = topPick === result.rank1 || topPick === result.rank2
                        const is3FukuHit = top3.includes(result.rank1) && top3.includes(result.rank2) && top3.includes(result.rank3)
                        const is3TanHit = top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3

                        if (isWinHit) hitBadges.push({ label: '単', type: 'win' })
                        if (isPlaceHit) hitBadges.push({ label: '複', type: 'place' })
                        if (is3FukuHit) hitBadges.push({ label: '3複', type: 'trifecta' })
                        if (is3TanHit) hitBadges.push({ label: '3単', type: 'trio' })
                      }
                    }

                    return (
                      <div
                        key={race.id}
                        className="race-card"
                      >
                        <div className="race-card-header">
                          <h3>{race.venue}</h3>
                          <span className="race-number">{race.raceNumber}R</span>
                        </div>
                        {isFinished && (
                          <div style={{
                            marginTop: '0.5rem',
                            display: 'flex',
                            gap: '0.3rem',
                            flexWrap: 'wrap',
                            justifyContent: 'center'
                          }}>
                            {hitBadges.length > 0 ? (
                              hitBadges.map((badge, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    padding: '0.3rem 0.6rem',
                                    background: '#10b981',
                                    color: 'white',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    fontWeight: '700',
                                  }}
                                >
                                  ✅ {badge.label}
                                </span>
                              ))
                            ) : (
                              <span
                                style={{
                                  padding: '0.3rem 0.6rem',
                                  background: '#ef4444',
                                  color: 'white',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: '700',
                                }}
                              >
                                ❌ 外れ
                              </span>
                            )}
                          </div>
                        )}
                        <button
                          className="predict-btn"
                          onClick={() => analyzeRace(race)}
                        >
                          予想を見る
                        </button>
                      </div>
                    )
                  })}
                </div>
                )
              })()}
            </section>

            {/* 予想結果セクション（App.jsxと同じ） */}
            {selectedRace && (
              <section ref={predictionRef} className="prediction-section">
                <h2>📊 AI予想結果 - {selectedRace.venue} {selectedRace.raceNumber}R</h2>

                {prediction && prediction.error ? (
                  <div className="prediction-error">
                    <p>{prediction.errorMessage}</p>
                  </div>
                ) : prediction && (
                  <>
                    {/* 公式サイトリンク */}
                    {selectedRace.rawData && selectedRace.rawData.venueCode && date && (
                      <div style={{
                        marginTop: '1rem',
                        marginBottom: '1.5rem',
                        padding: '0.75rem 1rem',
                        background: '#e3f2fd',
                        borderRadius: '8px',
                        borderLeft: '4px solid #2196f3'
                      }}>
                        <span style={{ marginRight: '0.5rem' }}>🔗</span>
                        <a
                          href={`https://www.boatrace.jp/owpc/pc/race/racelist?rno=${selectedRace.raceNumber}&jcd=${String(selectedRace.rawData.venueCode).padStart(2, '0')}&hd=${date.replace(/-/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#1976d2',
                            textDecoration: 'none',
                            fontWeight: '500'
                          }}
                        >
                          公式サイトでレース情報を見る
                        </a>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                          （新しいタブで開きます）
                        </span>
                      </div>
                    )}

                    {/* 荒れ度表示とモデル選択（予想表示時のみ） */}
                    {prediction.predictions && (
                      <>
                        {/* 荒れ度表示 */}
                        {volatility && (
                          <div style={{
                            padding: '1rem 1.5rem',
                            background: volatility.level === 'high' ? '#fff3e0' :
                              volatility.level === 'low' ? '#e8f5e9' : '#e3f2fd',
                            borderRadius: '8px',
                            marginBottom: '1.5rem',
                            borderLeft: `4px solid ${volatility.level === 'high' ? '#ff9800' :
                              volatility.level === 'low' ? '#4caf50' : '#2196f3'
                            }`
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: volatility.reasons && volatility.reasons.length > 0 ? '0.75rem' : '0' }}>
                              <span style={{ fontSize: '1.2rem' }}>
                                {volatility.level === 'high' ? '🌪️' :
                                  volatility.level === 'low' ? '🎯' : '⚖️'}
                              </span>
                              <span style={{ fontWeight: '600', color: '#333' }}>
                                荒れ度: {volatility.score}
                              </span>
                              <span style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '12px',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                background: volatility.level === 'high' ? '#ff9800' :
                                  volatility.level === 'low' ? '#4caf50' : '#2196f3',
                                color: 'white'
                              }}>
                                {volatility.level === 'high' ? '荒れる' :
                                  volatility.level === 'low' ? '堅い' : '標準'}
                              </span>
                            </div>

                            {/* 荒れ度の根拠 */}
                            {volatility.reasons && volatility.reasons.length > 0 && (
                              <div style={{
                                fontSize: '0.9rem',
                                color: '#555',
                                paddingLeft: '1.7rem',
                                marginTop: '0.75rem'
                              }}>
                                <ul style={{
                                  margin: '0',
                                  paddingLeft: '1.2rem',
                                  listStyleType: 'disc'
                                }}>
                                  {volatility.reasons.map((reason, index) => (
                                    <li key={index} style={{ marginBottom: '0.25rem' }}>
                                      {reason}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* おすすめモデル */}
                            {volatility.recommendedModel && (
                              <div style={{
                                marginTop: '0.75rem',
                                padding: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.5)',
                                borderRadius: '6px',
                                fontSize: '0.9rem'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '1.1rem' }}>💡</span>
                                  <span style={{ fontWeight: '600', color: '#333' }}>
                                    おすすめモデル:
                                  </span>
                                  <span style={{
                                    color: volatility.recommendedModel === 'upset-focus' ? '#ff6b00' :
                                      volatility.recommendedModel === 'safe-bet' ? '#2e7d32' : '#0ea5e9',
                                    fontWeight: '600'
                                  }}>
                                    {volatility.recommendedModel === 'standard' && 'スタンダード'}
                                    {volatility.recommendedModel === 'safe-bet' && '本命狙い'}
                                    {volatility.recommendedModel === 'upset-focus' && '穴狙い'}
                                  </span>
                                </div>
                                <div style={{
                                  marginTop: '0.35rem',
                                  paddingLeft: '1.6rem',
                                  fontSize: '0.85rem',
                                  color: '#666'
                                }}>
                                  {volatility.level === 'high' && '荒れ度が高いため、高配当を狙える穴狙い型がおすすめです'}
                                  {volatility.level === 'low' && '堅いレースのため、的中率重視の本命狙い型がおすすめです'}
                                  {volatility.level === 'medium' && '標準的なレースのため、バランス型のスタンダードがおすすめです'}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* モデルについて（説明セクション） */}
                        <div style={{
                          padding: '1.25rem 1.5rem',
                          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                          borderRadius: '8px',
                          marginBottom: '1.5rem',
                          border: '1px solid #e0e0e0'
                        }}>
                          <h4 style={{
                            margin: '0 0 1rem 0',
                            fontSize: '1.05rem',
                            fontWeight: '700',
                            color: '#333',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}>
                            <span>📚</span>
                            予想モデルについて
                          </h4>
                          <div style={{
                            display: 'grid',
                            gap: '1rem',
                            fontSize: '0.9rem'
                          }}>
                            {/* スタンダード */}
                            <div style={{
                              padding: '1rem',
                              background: 'white',
                              borderRadius: '6px',
                              borderLeft: '4px solid #0ea5e9'
                            }}>
                              <div style={{
                                fontWeight: '700',
                                color: '#0ea5e9',
                                marginBottom: '0.5rem',
                                fontSize: '0.95rem'
                              }}>
                                ⚖️ スタンダード（バランス型）
                              </div>
                              <div style={{ color: '#555', lineHeight: '1.6' }}>
                                <strong>特徴：</strong>的中率と配当のバランスを重視した万能型<br/>
                                <strong>重視する要素：</strong>全国勝率、当地成績、モーター性能を総合的に評価<br/>
                                <strong>適したレース：</strong>標準的な展開が予想されるレース<br/>
                                <strong>こんな人におすすめ：</strong>安定した的中を狙いつつ、適度な配当も期待したい方
                              </div>
                            </div>

                            {/* 本命狙い */}
                            <div style={{
                              padding: '1rem',
                              background: 'white',
                              borderRadius: '6px',
                              borderLeft: '4px solid #4caf50'
                            }}>
                              <div style={{
                                fontWeight: '700',
                                color: '#4caf50',
                                marginBottom: '0.5rem',
                                fontSize: '0.95rem'
                              }}>
                                🎯 本命狙い（安全型）
                              </div>
                              <div style={{ color: '#555', lineHeight: '1.6' }}>
                                <strong>特徴：</strong>的中率を最優先した堅実型<br/>
                                <strong>重視する要素：</strong>インコース有利性、A級選手、実績重視<br/>
                                <strong>適したレース：</strong>1号艇やA級選手が有力な堅い展開<br/>
                                <strong>こんな人におすすめ：</strong>的中率を重視し、コツコツ当てたい方
                              </div>
                            </div>

                            {/* 穴狙い */}
                            <div style={{
                              padding: '1rem',
                              background: 'white',
                              borderRadius: '6px',
                              borderLeft: '4px solid #ff9800'
                            }}>
                              <div style={{
                                fontWeight: '700',
                                color: '#ff9800',
                                marginBottom: '0.5rem',
                                fontSize: '0.95rem'
                              }}>
                                🌪️ 穴狙い（高配当型）
                              </div>
                              <div style={{ color: '#555', lineHeight: '1.6' }}>
                                <strong>特徴：</strong>高配当を狙った攻撃型<br/>
                                <strong>重視する要素：</strong>好調なモーター、展開の妙、外枠の可能性<br/>
                                <strong>適したレース：</strong>混戦模様や荒れる展開が予想されるレース<br/>
                                <strong>こんな人におすすめ：</strong>大きな配当を狙いたい、一発逆転を狙う方
                              </div>
                            </div>
                          </div>
                          <div style={{
                            marginTop: '1rem',
                            padding: '0.75rem',
                            background: 'rgba(255, 255, 255, 0.7)',
                            borderRadius: '6px',
                            fontSize: '0.85rem',
                            color: '#555',
                            lineHeight: '1.6'
                          }}>
                            <span>💡</span> <strong>ヒント：</strong>荒れ度スコアを参考に、レースの特性に合ったモデルを選択すると、より精度の高い予想が可能です。
                          </div>
                        </div>
                      </>
                    )}

                    {/* モデル選択ボタン */}
                    {prediction.predictions && (
                      <div style={{
                        display: 'flex',
                        gap: '0.75rem',
                        marginBottom: '1.5rem',
                        flexWrap: 'wrap'
                      }}>
                        <button
                          onClick={() => switchModel('standard')}
                          style={{
                            flex: '1',
                            minWidth: '140px',
                            padding: '0.75rem 1rem',
                            background: selectedModel === 'standard' ? 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' : 'white',
                            color: selectedModel === 'standard' ? 'white' : '#333',
                            border: selectedModel === 'standard' ? 'none' : '2px solid #e0e0e0',
                            borderRadius: '8px',
                            fontSize: '0.95rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: selectedModel === 'standard' ? '0 4px 12px rgba(14, 165, 233, 0.3)' : 'none'
                          }}
                        >
                          ⚖️ スタンダード
                        </button>
                        <button
                          onClick={() => switchModel('safe-bet')}
                          style={{
                            flex: '1',
                            minWidth: '140px',
                            padding: '0.75rem 1rem',
                            background: selectedModel === 'safe-bet' ? 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)' : 'white',
                            color: selectedModel === 'safe-bet' ? 'white' : '#333',
                            border: selectedModel === 'safe-bet' ? 'none' : '2px solid #e0e0e0',
                            borderRadius: '8px',
                            fontSize: '0.95rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: selectedModel === 'safe-bet' ? '0 4px 12px rgba(76, 175, 80, 0.3)' : 'none'
                          }}
                        >
                          🎯 本命狙い
                        </button>
                        <button
                          onClick={() => switchModel('upset-focus')}
                          style={{
                            flex: '1',
                            minWidth: '140px',
                            padding: '0.75rem 1rem',
                            background: selectedModel === 'upset-focus' ? 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)' : 'white',
                            color: selectedModel === 'upset-focus' ? 'white' : '#333',
                            border: selectedModel === 'upset-focus' ? 'none' : '2px solid #e0e0e0',
                            borderRadius: '8px',
                            fontSize: '0.95rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: selectedModel === 'upset-focus' ? '0 4px 12px rgba(255, 152, 0, 0.3)' : 'none'
                          }}
                        >
                          🌪️ 穴狙い
                        </button>
                      </div>
                    )}

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

                    {/* レース結果 */}
                    {prediction.result && prediction.result.finished && (
                      <div className="race-result">
                        <h4>🏁 レース結果</h4>

                        <div className="result-podium">
                          <div className="podium-item first">
                            <div className="rank">1着</div>
                            <div className="boat-number">{prediction.result.rank1}</div>
                          </div>
                          <div className="podium-item second">
                            <div className="rank">2着</div>
                            <div className="boat-number">{prediction.result.rank2}</div>
                          </div>
                          <div className="podium-item third">
                            <div className="rank">3着</div>
                            <div className="boat-number">{prediction.result.rank3}</div>
                          </div>
                        </div>

                        <div className="accuracy-check">
                          {/* 単勝 */}
                          <div className="check-item">
                            {prediction.topPick.number === prediction.result.rank1 ? (
                              <div className="hit">
                                ✅ 単勝的中！
                                {(() => {
                                  const payout = prediction.result.payouts?.win?.[String(prediction.topPick.number)];
                                  return payout && (
                                    <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                      配当: {payout}円
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="miss">❌ 単勝外れ（予想: {prediction.topPick.number}号艇 → 実際: {prediction.result.rank1}号艇）</div>
                            )}
                          </div>

                          {/* 複勝 */}
                          <div className="check-item">
                            {(prediction.topPick.number === prediction.result.rank1 ||
                              prediction.topPick.number === prediction.result.rank2) ? (
                              <div className="hit">
                                ✅ 複勝的中！
                                {(() => {
                                  const payout = prediction.result.payouts?.place?.[String(prediction.topPick.number)];
                                  return payout && (
                                    <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                      配当: {payout}円
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="miss">❌ 複勝外れ</div>
                            )}
                          </div>

                          {/* 3連複 */}
                          <div className="check-item">
                            {prediction.top3.includes(prediction.result.rank1) &&
                            prediction.top3.includes(prediction.result.rank2) &&
                            prediction.top3.includes(prediction.result.rank3) ? (
                              <div className="hit">
                                ✅ 3連複的中！
                                {(() => {
                                  const sorted = [prediction.result.rank1, prediction.result.rank2, prediction.result.rank3].sort((a, b) => a - b);
                                  const key = sorted.join('-');
                                  const payout = prediction.result.payouts?.trifecta?.[key];
                                  return payout && (
                                    <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                      配当: {payout}円
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="miss">❌ 3連複外れ</div>
                            )}
                          </div>

                          {/* 3連単 */}
                          <div className="check-item">
                            {prediction.top3[0] === prediction.result.rank1 &&
                            prediction.top3[1] === prediction.result.rank2 &&
                            prediction.top3[2] === prediction.result.rank3 ? (
                              <div className="hit">
                                ✅ 3連単的中！
                                {(() => {
                                  const key = `${prediction.result.rank1}-${prediction.result.rank2}-${prediction.result.rank3}`;
                                  const payout = prediction.result.payouts?.trio?.[key];
                                  return payout && (
                                    <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                      配当: {payout}円
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="miss">❌ 3連単外れ</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 全艇情報 */}
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
                            <tr key={player.number} className={prediction.top3.includes(player.number) ? 'recommended' : ''}>
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
                  </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
      </div>
    </>
  )
}

export default RaceDetail
