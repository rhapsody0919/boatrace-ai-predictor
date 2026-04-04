import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Header from '../components/Header'
import Breadcrumb from '../components/Breadcrumb'
import ModelComparisonTable from '../components/ModelComparisonTable'
import {
  VenueSelector,
  RaceCard,
  PredictionPanel
} from '../components/race'
import { dataService } from '../services/dataService'
import { STADIUM_NAMES } from '../constants'
import { formatDate } from '../utils/formatters'
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
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const predictionRef = useRef(null)

  // 会場・レースマップを構築する共通関数
  const applyRaceData = (data) => {
    setRaceData(data)

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

    Object.values(venueMap).forEach(venue => {
      venue.races.sort((a, b) => a.raceNumber - b.raceNumber)
    })

    return Object.values(venueMap).sort((a, b) => a.placeCd - b.placeCd)
  }

  // レースデータを取得（2段階ロード: 軽量版 → フル版）
  useEffect(() => {
    let cancelled = false

    const fetchRaceData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Phase 1: 軽量版で即座に一覧表示
        const lightData = await dataService.getPredictions(date, { light: true })
        if (cancelled) return

        if (!lightData.races || lightData.races.length === 0) {
          throw new Error('データが見つかりません')
        }

        const venues = applyRaceData(lightData)
        setVenuesData(venues)
        if (venues.length > 0) {
          setSelectedVenueId(venues[0].placeCd)
        }
        setLoading(false)

        // Phase 2: バックグラウンドでフル版を取得（turnPrediction/racerStats含む）
        const fullData = await dataService.getPredictions(date)
        if (cancelled) return

        if (fullData.races && fullData.races.length > 0) {
          const fullVenues = applyRaceData(fullData)
          setVenuesData(fullVenues)
        }

      } catch (err) {
        console.error('データ取得エラー:', err)
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      }
    }

    fetchRaceData()
    return () => { cancelled = true }
  }, [date])

  // フル版到着時 or レース選択時に selectedRace を最新データと同期
  // （2段階ロードで軽量版 → フル版に切り替わった時の自動リフレッシュ）
  useEffect(() => {
    if (!raceData?.races || !selectedRace) return

    const latestRawData = raceData.races.find(r => r.raceId === selectedRace.id)
    // 参照が同じなら何もしない（無限ループ防止 & 不要な再描画防止）
    if (!latestRawData || latestRawData === selectedRace.rawData) return

    // 新しい rawData で selectedRace を更新
    const upgradedRace = { ...selectedRace, rawData: latestRawData }
    setSelectedRace(upgradedRace)

    // prediction が表示中なら新データで再計算（turnPrediction / racerStats 反映）
    if (prediction && !prediction.error && !isAnalyzing) {
      processRacePrediction(upgradedRace)
    }
    // raceData と selectedRace.id を監視し、最新の state を closure で取得
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceData, selectedRace?.id])

  // モデル切り替え
  const switchModel = (model) => {
    if (!prediction || !prediction.predictions) return

    setSelectedModel(model)

    const modelKey = model === 'safe-bet' ? 'safeBet' :
      model === 'upset-focus' ? 'upsetFocus' : 'standard'
    const modelPrediction = prediction.predictions[modelKey]

    if (modelPrediction) {
      const topPickPlayer = modelPrediction.players?.find(
        p => p.number === modelPrediction.topPick
      )
      const top3Players = (modelPrediction.top3 || []).map(num =>
        modelPrediction.players?.find(p => p.number === num)
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
    setIsAnalyzing(true)
    setPrediction(null)

    setTimeout(() => {
      setIsAnalyzing(false)
      processRacePrediction(race)
      setTimeout(() => {
        predictionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }, 500)
  }

  const processRacePrediction = (race) => {
    const racePrediction = race.rawData
    const hasNewFormat = !!racePrediction?.predictions
    const hasOldFormat = !!racePrediction?.prediction

    if (!racePrediction || (!hasNewFormat && !hasOldFormat)) {
      setPrediction({ error: true, errorMessage: '予想データがありません' })
      return
    }

    if (racePrediction.volatility) {
      setVolatility(racePrediction.volatility)
    } else {
      setVolatility(null)
    }

    const modelKey = selectedModel === 'safe-bet' ? 'safeBet' :
      selectedModel === 'upset-focus' ? 'upsetFocus' : 'standard'

    let modelPrediction
    if (hasNewFormat) {
      modelPrediction = racePrediction.predictions[modelKey]
    } else {
      if (modelKey !== 'standard') {
        setPrediction({
          error: true,
          errorMessage: 'この日付のデータはスタンダードモデルのみ対応しています'
        })
        return
      }
      modelPrediction = racePrediction.prediction
    }

    if (!modelPrediction) {
      setPrediction({ error: true, errorMessage: 'このモデルの予想データがありません' })
      return
    }

    const topPickPlayer = modelPrediction.players?.find(
      p => p.number === modelPrediction.topPick
    )
    const top3Players = (modelPrediction.top3 || []).map(num =>
      modelPrediction.players?.find(p => p.number === num)
    )

    setPrediction({
      topPick: topPickPlayer,
      recommended: top3Players,
      allPlayers: modelPrediction.players,
      confidence: modelPrediction.confidence,
      reasoning: modelPrediction.reasoning || ['予想根拠データなし'],
      top3: modelPrediction.top3,
      result: racePrediction.result,
      predictions: racePrediction.predictions || { standard: racePrediction.prediction },
      turnPrediction: racePrediction.turnPrediction || null,
      racerStats: racePrediction.racerStats || null,
    })
  }

  const breadcrumbItems = [
    { label: 'ホーム', path: '/' },
    { label: '過去の予想', path: '/races' },
    { label: formatDate(date), path: `/races/${date}` }
  ]

  // 全モデルの統計を計算
  const getModelComparison = () => {
    if (!raceData || !raceData.races) return null

    const hasNewFormat = raceData.races.some(r => r.predictions)
    const models = hasNewFormat ? ['standard', 'safeBet', 'upsetFocus'] : ['standard']
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
        const prediction = race.predictions?.[modelKey] || (modelKey === 'standard' ? race.prediction : null)
        if (!prediction) return

        const topPick = prediction.topPick
        const top3 = prediction.top3
        const result = race.result

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
          const sorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b)
          const trifectaKey = sorted.join('-')
          trifecta3Payouts += result.payouts?.trifecta?.[trifectaKey] || 0
        }
        if (top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3) {
          trio3Hits++
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
  const selectedVenue = venuesData.find(v => v.placeCd === selectedVenueId)
  const races = selectedVenue?.races || []

  return (
    <>
      <Helmet>
        <title>{formatDate(date)}のAI予想データ - BoatAI</title>
        <meta name="description" content={`${formatDate(date)}のボートレースAI予想データと的中実績。各レース場の予想結果を確認できます。`} />
        <meta property="og:title" content={`${formatDate(date)}のAI予想データ - BoatAI`} />
        <meta property="og:description" content={`${formatDate(date)}のボートレースAI予想データと的中実績`} />
        <link rel="canonical" href={`https://www.boat-ai.jp/races/${date}`} />
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
              <ModelComparisonTable
                data={modelComparison}
                showRaceCount={true}
                title="📊 モデル間パフォーマンス比較"
              />

              <VenueSelector
                venuesData={venuesData}
                selectedVenueId={selectedVenueId}
                onVenueChange={setSelectedVenueId}
              />

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

                {races.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
                    <p>このレース場のデータはありません</p>
                  </div>
                ) : (
                  <div className="race-grid">
                    {races.map(race => (
                      <RaceCard
                        key={race.id}
                        race={race}
                        selectedModel={selectedModel}
                        onAnalyzeRace={analyzeRace}
                      />
                    ))}
                  </div>
                )}
              </section>

              {selectedRace && (
                <section ref={predictionRef} className="prediction-section">
                  <h2>&#x1F4CA; AI予想結果 - {selectedRace.venue} {selectedRace.raceNumber}R</h2>
                  <PredictionPanel
                    prediction={prediction}
                    selectedRace={selectedRace}
                    selectedModel={selectedModel}
                    onSwitchModel={switchModel}
                    volatility={volatility}
                    isAnalyzing={isAnalyzing}
                    date={date}
                  />
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
