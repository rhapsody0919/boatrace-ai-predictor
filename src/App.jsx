import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import Header from './components/Header'
import AccuracyDashboard from './components/AccuracyDashboard'
import PrivacyPolicy from './components/PrivacyPolicy'
import Terms from './components/Terms'
import Contact from './components/Contact'
import HitRaces from './components/HitRaces'
import TodaysPicks from './components/TodaysPicks'
import UpdateStatus from './components/UpdateStatus'
import { getFeaturedPosts, getLatestPosts } from './data/blogPosts'
import { dataService } from './services/dataService'
import { PredictionPanel } from './components/race'
import { STADIUM_NAMES, WEEKDAYS } from './constants'
import { GRADE_CONFIG } from './constants/gradeConfig'
import { TECHNIQUE_NAMES } from './utils/turnPrediction'
import { BOAT_COLORS } from './utils/colors'
import { getTodayJST, formatDateJP } from './utils/dateUtils'
import LoadingScreen from './components/LoadingScreen'

function App({ tab = 'races' }) {
    const navigate = useNavigate()
    const location = useLocation()
    const [activeTab, setActiveTab] = useState(tab)
    const [selectedRace, setSelectedRace] = useState(null)
    const [prediction, setPrediction] = useState(null)
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [isRealData, setIsRealData] = useState(false)
    const [allVenuesData, setAllVenuesData] = useState([])
    const [selectedVenueId, setSelectedVenueId] = useState(null)
    const [races, setRaces] = useState([])
    const [selectedModel, setSelectedModel] = useState('standard') // 予想モデル選択
    const [volatility, setVolatility] = useState(null) // 荒れ度情報
    const [lastUpdated, setLastUpdated] = useState(null) // データ更新時刻
    const [isRefreshing, setIsRefreshing] = useState(false) // 手動更新中フラグ
    const [turnPredictionMap, setTurnPredictionMap] = useState({}) // レースID→展開予測のマップ
    const predictionRef = useRef(null)
    const raceCardRefs = useRef({}) // 各レースカードへの参照を保持

    // 本日の日付をフォーマット
    const getTodayDateShort = () => {
        const today = new Date()
        const month = today.getMonth() + 1
        const day = today.getDate()
        const weekday = WEEKDAYS[today.getDay()]
        return `${month}/${day}(${weekday})`
    }

    // propsのtabが変わったらactiveTabを更新
    useEffect(() => {
        setActiveTab(tab)
    }, [tab])

    // おすすめページからの自動レース選択
    useEffect(() => {
        if (location.state?.autoSelectRace && allVenuesData.length > 0) {
            const { venueCode, raceNo, venueName } = location.state.autoSelectRace

            // 該当レースを検索
            for (const venue of allVenuesData) {
                const venueId = String(venue.placeCd || venue.venueId || '').padStart(2, '0')
                if (venueId === venueCode) {
                    const race = venue.races?.find(r => r.raceNo === raceNo)
                    if (race) {
                        // フォーマットしてanalyzeRaceを呼び出す
                        const formattedRace = {
                            venue: venueName,
                            venueId: venueCode,
                            raceNumber: raceNo,
                            rawData: race
                        }
                        analyzeRace(formattedRace)
                        break
                    }
                }
            }

            // stateをクリアして再選択を防ぐ
            navigate('/', { replace: true, state: {} })
        }
    }, [location.state, allVenuesData])

    // Google Analytics初期化
    useEffect(() => {
        const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID

        if (gaId && gaId !== '%VITE_GA_MEASUREMENT_ID%') {
            // Google Analyticsスクリプトを動的に追加
            const script1 = document.createElement('script')
            script1.async = true
            script1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`
            document.head.appendChild(script1)

            // gtag初期化
            window.dataLayer = window.dataLayer || []
            function gtag() {
                window.dataLayer.push(arguments)
            }
            gtag('js', new Date())
            gtag('config', gaId, {
                page_path: window.location.pathname,
            })

            // グローバルに設定
            window.gtag = gtag

            console.log('Google Analytics initialized:', gaId)
        }
    }, [])

    // ページビュー追跡（タブ切り替え時）
    useEffect(() => {
        if (window.gtag) {
            window.gtag('event', 'page_view', {
                page_title: activeTab,
                page_location: window.location.href,
                page_path: window.location.pathname,
            })
        }
    }, [activeTab])


    // リトライ機能付きfetch関数
    const fetchWithRetry = async (url, maxRetries = 3, retryDelay = 2000) => {
        let lastError

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url)
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                }
                return response
            } catch (error) {
                lastError = error
                console.warn(`取得失敗 (${i + 1}/${maxRetries}):`, error.message)

                // 最後の試行でなければ待機してリトライ
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay))
                }
            }
        }

        throw lastError
    }

    // レースデータを取得（初回読み込み＆手動更新で使用）
    const fetchRaceData = async () => {
        try {
            setLoading(true)
            setError(null)

            // データサービス経由で取得（DB移行に備えて抽象化）
            const result = await dataService.getRaces()

            if (!result.success || !result.data) {
                throw new Error('有効なデータが取得できませんでした')
            }

            // レース場データを保存
            console.log('📊 取得したデータ:', result.data)
            console.log('📊 最初の会場のレース:', result.data[0]?.races)
            console.log('📊 最初のレースのracers:', result.data[0]?.races[0]?.racers)
            setAllVenuesData(result.data)
            setIsRealData(true)

            // データ更新時刻を保存
            if (result.scrapedAt) {
                setLastUpdated(result.scrapedAt)
            }

            // 最初に開催されているレース場を自動選択
            if (result.data.length > 0) {
                setSelectedVenueId(result.data[0].placeCd)
            }

            // 展開予測プレビュー用: 予測データをバックグラウンドで取得
            const today = (() => {
                const now = new Date()
                const jstOffset = 9 * 60
                const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000)
                return jstDate.toISOString().split('T')[0]
            })()
            dataService.getPredictions(today).then(predData => {
                if (predData?.races) {
                    const map = {}
                    for (const race of predData.races) {
                        if (race.turnPrediction) {
                            map[race.raceId] = race.turnPrediction
                        }
                    }
                    setTurnPredictionMap(map)
                }
            }).catch(() => { })

        } catch (err) {
            console.error('API取得エラー:', err)
            setError(err.message)
            setIsRealData(false)
        } finally {
            setLoading(false)
        }
    }

    // 手動更新関数
    const handleRefresh = async () => {
        setIsRefreshing(true)
        try {
            // キャッシュをクリアして最新データを取得
            dataService.clearCache()
            await fetchRaceData()
        } finally {
            setIsRefreshing(false)
        }
    }

    // 実際のAPIからデータを取得
    useEffect(() => {
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
                        id: `${race.date}-${String(race.placeCd).padStart(2, '0')}-${String(race.raceNo).padStart(2, '0')}`,
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

    // レース一覧が読み込まれたら、次に開催されるレースに自動スクロール
    useEffect(() => {
        if (races.length === 0 || loading) return

        // 現在時刻（JST）を取得
        const now = new Date()
        const jstOffset = 9 * 60 // JST is UTC+9
        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000)
        const currentHours = jstNow.getUTCHours()
        const currentMinutes = jstNow.getUTCMinutes()
        const currentTimeInMinutes = currentHours * 60 + currentMinutes

        // 次に開催されるレースを探す
        let nextRace = null
        let minTimeDiff = Infinity

        races.forEach(race => {
            if (race.startTime && race.startTime !== '未定') {
                const [hours, minutes] = race.startTime.split(':').map(Number)
                const raceTimeInMinutes = hours * 60 + minutes
                const timeDiff = raceTimeInMinutes - currentTimeInMinutes

                // 現在時刻より後のレースで、最も近いものを選択
                if (timeDiff > 0 && timeDiff < minTimeDiff) {
                    minTimeDiff = timeDiff
                    nextRace = race
                }
            }
        })

        // 次のレースが見つからない場合は、最後のレース（最も新しいレース）を選択
        if (!nextRace && races.length > 0) {
            nextRace = races.reduce((latest, race) => {
                return race.raceNumber > latest.raceNumber ? race : latest
            }, races[0])
        }

        // 次のレースが見つかった場合、そのレースカードにスクロール
        if (nextRace && raceCardRefs.current[nextRace.id]) {
            // 少し遅延させてDOM要素が確実に描画されてからスクロール
            setTimeout(() => {
                raceCardRefs.current[nextRace.id]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                })
            }, 500)
        }
    }, [races, loading])

    // 予想データをSupabaseから読み込む
    const loadPredictionData = async (race) => {
        try {
            // レースの日付を取得（rawDataから、なければ今日の日付）
            const dateStr = race.rawData?.date || (() => {
                const now = new Date()
                const jstOffset = 9 * 60
                const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000)
                return jstDate.toISOString().split('T')[0]
            })()

            // Supabaseから予想データを取得
            const predictionData = await dataService.getPredictions(dateStr)

            // レースIDを生成して該当する予想を探す
            const venueCode = race.rawData?.placeCd || 0
            const raceId = `${dateStr}-${String(venueCode).padStart(2, '0')}-${String(race.raceNumber).padStart(2, '0')}`
            const racePrediction = predictionData.races?.find(r => r.raceId === raceId)

            if (!racePrediction) {
                console.warn(`レースID ${raceId} の予想が見つかりません`)
                return null
            }

            return racePrediction
        } catch (error) {
            console.error('❌ 予想データの読み込みエラー:', error)
            return null
        }
    }

    // モデル切り替え関数
    const switchModel = (model) => {
        if (!prediction || !prediction.predictions) return

        setSelectedModel(model)

        // 選択されたモデルの予想データに切り替え
        const modelKey = model === 'safe-bet' ? 'safeBet' :
            model === 'upset-focus' ? 'upsetFocus' : 'standard'
        const modelPrediction = prediction.predictions[modelKey]

        if (modelPrediction && modelPrediction.players) {
            const topPickPlayer = modelPrediction.players.find(
                p => p.number === modelPrediction.topPick
            )
            const top3Players = (modelPrediction.top3 || []).map(num =>
                modelPrediction.players.find(p => p.number === num)
            )

            setPrediction({
                ...prediction,
                topPick: topPickPlayer,
                recommended: top3Players,
                allPlayers: modelPrediction.players,
                confidence: modelPrediction.confidence,
                reasoning: modelPrediction.reasoning || [],
                top3: modelPrediction.top3 || []
            })
        }
    }

    const analyzeRace = async (race) => {
        setSelectedRace(race)
        setIsAnalyzing(true)
        setPrediction(null)

        // 次フレームで即座にスクロール（selectedRaceセットによりsectionがレンダリングされた後）
        requestAnimationFrame(() => {
            if (predictionRef.current) {
                predictionRef.current.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                })
            }
        })

        try {
            // JSONファイルから予想データを読み込み
            const racePrediction = await loadPredictionData(race)

            if (!racePrediction) {
                // データがない場合はエラーを表示
                console.error('❌ 予想データが見つかりません')
                setPrediction({
                    error: true,
                    errorMessage: 'このレースの予想データがまだ生成されていません。しばらくしてから再度お試しください。'
                })
                setIsAnalyzing(false)
                return
            }

            // 荒れ度情報を保存（新しいデータ構造に対応）
            let currentModel = 'standard'
            if (racePrediction.volatility) {
                setVolatility(racePrediction.volatility)
                // 推奨モデルを自動選択
                currentModel = racePrediction.volatility.recommendedModel || 'standard'
                setSelectedModel(currentModel)
            } else {
                setVolatility(null)
            }

            // 予想データをUIの形式に変換
            setTimeout(() => {
                // 選択されたモデルの予想を取得（後方互換性のため古いデータ構造もサポート）
                let modelPrediction
                if (racePrediction.predictions) {
                    // 新しいデータ構造（3モデル対応）
                    const modelKey = currentModel === 'safe-bet' ? 'safeBet' :
                        currentModel === 'upset-focus' ? 'upsetFocus' : 'standard'
                    modelPrediction = racePrediction.predictions[modelKey]
                } else {
                    // 古いデータ構造（後方互換性）
                    modelPrediction = racePrediction.prediction
                }

                if (!modelPrediction || !modelPrediction.players) {
                    console.error('❌ モデル予想データが見つかりません:', currentModel)
                    setPrediction({
                        error: true,
                        errorMessage: 'このモデルの予想データが見つかりません。'
                    })
                    setIsAnalyzing(false)
                    return
                }

                const topPickPlayer = modelPrediction.players.find(
                    p => p.number === modelPrediction.topPick
                )
                const top3Players = (modelPrediction.top3 || []).map(num =>
                    modelPrediction.players.find(p => p.number === num)
                )

                const aiPrediction = {
                    topPick: topPickPlayer,
                    recommended: top3Players,
                    allPlayers: modelPrediction.players,
                    confidence: modelPrediction.confidence,
                    reasoning: modelPrediction.reasoning || [], // 未設定の場合は空配列
                    top3: modelPrediction.top3 || [], // トップ3の艇番（number配列）
                    result: racePrediction.result, // レース結果
                    predictions: racePrediction.predictions, // 全モデルの予想データ
                    turnPrediction: racePrediction.turnPrediction || null,
                    racerStats: racePrediction.racerStats || null,
                    exhibitionData: racePrediction.exhibitionData || null,
                    predictionOdds: racePrediction.predictionOdds || null,
                }
                setPrediction(aiPrediction)
                setIsAnalyzing(false)
            }, 1000) // 読み込み演出のため1秒待機
        } catch (error) {
            console.error('❌ 予想の表示エラー:', error)
            setIsAnalyzing(false)
        }
    }

    const generatePlayers = (race) => {
        // 実データから選手情報を取得
        // raceはフォーマット済みオブジェクトで、実データはrawDataに格納されている
        console.log('🔍 race:', race)
        console.log('🔍 race.rawData:', race?.rawData)
        console.log('🔍 race.rawData.racers:', race?.rawData?.racers)

        const racers = race?.rawData?.racers

        if (!racers || racers.length === 0) {
            console.error('❌ racers データがありません')
            return null
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
    return (
        <div className="app">
            <Header />

            <div className="container">
                <main className="main-content">
                    {activeTab === 'privacy' ? (
                        <PrivacyPolicy />
                    ) : activeTab === 'terms' ? (
                        <Terms />
                    ) : activeTab === 'contact' ? (
                        <Contact />
                    ) : activeTab === 'accuracy' ? (
                        <AccuracyDashboard
                            onRefresh={handleRefresh}
                            isRefreshing={isRefreshing}
                        />
                    ) : activeTab === 'hit-races' ? (
                        <HitRaces
                            allVenuesData={allVenuesData}
                            analyzeRace={analyzeRace}
                            stadiumNames={STADIUM_NAMES}
                            fetchWithRetry={fetchWithRetry}
                            lastUpdated={lastUpdated}
                            onRefresh={handleRefresh}
                            isRefreshing={isRefreshing}
                        />
                    ) : activeTab === 'picks' ? (
                        <TodaysPicks />
                    ) : (
                        <>
                            <section className="race-list-section">
                                <h2>🏁 本日開催中のレース {getTodayDateShort()}</h2>
                                <UpdateStatus
                                    lastUpdated={lastUpdated}
                                    dataType="レースデータ"
                                    onRefresh={handleRefresh}
                                    isRefreshing={isRefreshing}
                                />

                                {loading ? (
                                    <LoadingScreen
                                        title="レースデータを読み込み中..."
                                        description="本日のレース情報を取得しています"
                                    />
                                ) : (
                                    <>
                                        {error && (
                                            <div style={{ padding: '1.5rem', background: '#fff3cd', borderRadius: '8px', marginBottom: '1rem', border: '2px solid #ffc107' }}>
                                                <p style={{ color: '#856404', fontWeight: 'bold', marginBottom: '0.5rem' }}>⚠️ データ取得エラー</p>
                                                <p style={{ color: '#856404', marginBottom: '1rem' }}>{error}</p>
                                                <p style={{ color: '#856404', fontSize: '0.9rem', marginBottom: '1rem' }}>
                                                    データの取得に失敗しました。ネットワーク接続を確認するか、しばらくしてから再度お試しください。
                                                </p>
                                                <button
                                                    onClick={() => window.location.reload()}
                                                    style={{
                                                        padding: '0.75rem 1.5rem',
                                                        background: '#ffc107',
                                                        color: '#000',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        fontWeight: 'bold',
                                                        fontSize: '1rem'
                                                    }}
                                                >
                                                    🔄 再読み込み
                                                </button>
                                            </div>
                                        )}

                                        {/* レース場選択ドロップダウン */}
                                        {allVenuesData.length > 0 && (
                                            <div style={{ marginBottom: '1.5rem' }}>
                                                <label htmlFor="venue-select" style={{
                                                    display: 'block',
                                                    marginBottom: '0.5rem',
                                                    fontWeight: 'bold',
                                                    fontSize: '1.1rem',
                                                    color: 'white'
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
                                                    {(allVenuesData || []).map(venue => (
                                                        <option key={venue.placeCd} value={venue.placeCd}>
                                                            {venue.placeName} ({venue.races?.length || 0}レース)
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {races.length === 0 && !error ? (
                                            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                                <p>本日、このレース場での開催はありません</p>
                                            </div>
                                        ) : (
                                            <div className="race-grid">
                                                {races.map(race => {
                                                    // レースが終了しているかチェック
                                                    const isFinished = (() => {
                                                        if (!race.startTime || race.startTime === '未定') return false
                                                        const now = new Date()
                                                        const jstOffset = 9 * 60
                                                        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000)
                                                        const currentTimeInMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes()
                                                        const [hours, minutes] = race.startTime.split(':').map(Number)
                                                        const raceTimeInMinutes = hours * 60 + minutes
                                                        return raceTimeInMinutes < currentTimeInMinutes
                                                    })()

                                                    const turnPreview = turnPredictionMap[race.id]
                                                    const topPattern = turnPreview?.patterns?.[0]
                                                    const volatility = race.rawData?.volatility
                                                    const isHighVol = volatility?.level === 'high'
                                                    const isLowVol = volatility?.level === 'low'
                                                    const showVolBadge = isHighVol || isLowVol
                                                    const volBadgeColor = isHighVol ? '#c62828' : '#2e7d32'
                                                    const volBadgeLabel = isHighVol ? '🌪️ イン崩れ確率高' : '🎯 本命有利'

                                                    const raceGrade = race.rawData?.raceGrade
                                                    const gradeConfig = GRADE_CONFIG[raceGrade]

                                                    return (
                                                        <div
                                                            key={race.id}
                                                            className="race-card"
                                                            ref={el => raceCardRefs.current[race.id] = el}
                                                            style={showVolBadge ? { borderLeft: `4px solid ${volBadgeColor}` } : undefined}
                                                        >
                                                            <div className="race-card-header">
                                                                <h3>{race.venue}</h3>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    {showVolBadge && (
                                                                        <span style={{
                                                                            padding: '0.2rem 0.55rem',
                                                                            borderRadius: '8px',
                                                                            fontSize: '0.7rem',
                                                                            fontWeight: '700',
                                                                            background: volBadgeColor,
                                                                            color: '#fff',
                                                                            letterSpacing: '0.02em',
                                                                            whiteSpace: 'nowrap',
                                                                        }}>
                                                                            {volBadgeLabel}
                                                                        </span>
                                                                    )}
                                                                    {gradeConfig && (
                                                                        <span style={{
                                                                            padding: '0.2rem 0.5rem',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.7rem',
                                                                            fontWeight: '700',
                                                                            background: gradeConfig.color,
                                                                            color: '#fff',
                                                                            letterSpacing: '0.05em',
                                                                            whiteSpace: 'nowrap',
                                                                        }}>
                                                                            {gradeConfig.label}
                                                                        </span>
                                                                    )}
                                                                    <span className="race-number">{race.raceNumber}R</span>
                                                                </div>
                                                            </div>
                                                            <div className="race-info">
                                                                <div className="info-item">
                                                                    <span className="label">締切予定時刻</span>
                                                                    <span className="value">{race.startTime}</span>
                                                                </div>
                                                                {isFinished && (
                                                                    <div style={{
                                                                        marginTop: '0.5rem',
                                                                        padding: '0.4rem 0.8rem',
                                                                        background: '#e0e0e0',
                                                                        borderRadius: '6px',
                                                                        textAlign: 'center',
                                                                        fontSize: '0.85rem',
                                                                        fontWeight: '600',
                                                                        color: '#475569'
                                                                    }}>
                                                                        ⏱️ 終了
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {topPattern && (
                                                                <div className="race-card-turn-preview">
                                                                    <span className="turn-preview-label">展開予測</span>
                                                                    <div className="turn-preview-content">
                                                                        <span
                                                                            className="turn-preview-course"
                                                                            style={{
                                                                                backgroundColor: (BOAT_COLORS[topPattern.winnerCourse] || BOAT_COLORS[1]).bg,
                                                                                color: (BOAT_COLORS[topPattern.winnerCourse] || BOAT_COLORS[1]).text,
                                                                            }}
                                                                        >
                                                                            {topPattern.winnerCourse}
                                                                        </span>
                                                                        <span className="turn-preview-technique">
                                                                            {TECHNIQUE_NAMES[topPattern.technique] || topPattern.technique}
                                                                        </span>
                                                                        <span className="turn-preview-prob">
                                                                            {Math.round(topPattern.probability * 100)}%
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            <button
                                                                className="predict-btn"
                                                                onClick={() => analyzeRace(race)}
                                                            >
                                                                AI予想を見る
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </>
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
                                        showExhibition={true}
                                    />
                                </section>
                            )}

                            {/* ブログ記事セクション */}
                            <section className="blog-preview-section">
                                <h2>📝 ボートレース攻略ブログ</h2>
                                <p className="blog-preview-lead">
                                    予想のコツ、会場別攻略、データ分析手法など、勝率アップに役立つ情報をお届けします
                                </p>
                                <div className="blog-preview-grid">
                                    {getFeaturedPosts().slice(0, 5).map(post => (
                                        <Link to={`/blog/${post.id}`} key={post.id} className="blog-preview-card">
                                            <span className="blog-preview-category">{post.category}</span>
                                            <h3 className="blog-preview-title">{post.title}</h3>
                                            <p className="blog-preview-desc">{post.description}</p>
                                            <div className="blog-preview-meta">
                                                <span>{post.readTime}</span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                                <div className="blog-preview-cta">
                                    <Link to="/blog" className="blog-preview-btn">
                                        全てのブログ記事を見る →
                                    </Link>
                                </div>
                            </section>
                        </>
                    )}
                </main>
            </div>

            <footer className="footer">
                <p>※本サイトはAIによる予測情報を提供するものであり、結果を保証するものではありません</p>
                <p className="last-updated" style={{
                    fontSize: '0.9rem',
                    color: 'white',
                    marginTop: '0.5rem'
                }}>
                    {(() => {
                        const latestPost = getLatestPosts(1)[0];
                        return latestPost ? `ブログ最終更新: ${formatDateJP(latestPost.date)}` : '';
                    })()}
                </p>
                <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    marginTop: '0.75rem',
                    marginBottom: '0.75rem'
                }}>
                    <Link to="/blog" style={{ color: 'white', textDecoration: 'none' }}>ブログ</Link>
                    <Link to="/about" style={{ color: 'white', textDecoration: 'none' }}>About</Link>
                    <Link to="/profile" style={{ color: 'white', textDecoration: 'none' }}>運営者</Link>
                    <Link to="/faq" style={{ color: 'white', textDecoration: 'none' }}>FAQ</Link>
                    <Link to="/privacy" style={{ color: 'white', textDecoration: 'none' }}>プライバシーポリシー</Link>
                    <Link to="/terms" style={{ color: 'white', textDecoration: 'none' }}>利用規約</Link>
                    <Link to="/contact" style={{ color: 'white', textDecoration: 'none' }}>お問い合わせ</Link>
                    <Link to="/responsible-gambling" style={{ color: 'white', textDecoration: 'none' }}>責任あるギャンブル</Link>
                </div>
                <p>&copy; 2025 BoatAI - All Rights Reserved</p>
            </footer>
        </div>
    )
}

export default App
