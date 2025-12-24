import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import AccuracyDashboard from './components/AccuracyDashboard'
import PrivacyPolicy from './components/PrivacyPolicy'
import Terms from './components/Terms'
import Contact from './components/Contact'
import HitRaces from './components/HitRaces'
import UpdateStatus from './components/UpdateStatus'
import { ShareButton } from './components/ShareButton'
import { SocialShareButtons } from './components/SocialShareButtons'
import { shareRacePredictionToX, generatePredictionShareText } from './utils/share'

function App() {
    // URLのハッシュから初期タブを決定
    const getInitialTab = () => {
        const hash = window.location.hash.slice(1) // '#' を除去
        const validTabs = ['races', 'hit-races', 'accuracy', 'privacy', 'terms', 'contact']
        return validTabs.includes(hash) ? hash : 'races'
    }

    const [activeTab, setActiveTab] = useState(getInitialTab())
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
    const [isMenuOpen, setIsMenuOpen] = useState(false) // サブメニュー開閉状態
    const predictionRef = useRef(null)

    // レース場番号から名前へのマッピング
    const stadiumNames = {
        1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
        7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
        13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
        19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
    }

    // 本日の日付をフォーマット
    const getTodayDateShort = () => {
        const today = new Date()
        const month = today.getMonth() + 1
        const day = today.getDate()
        const weekdays = ['日', '月', '火', '水', '木', '金', '土']
        const weekday = weekdays[today.getDay()]
        return `${month}/${day}(${weekday})`
    }

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
                page_path: window.location.pathname + window.location.search + window.location.hash,
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
                page_path: window.location.pathname + window.location.hash,
            })
        }
    }, [activeTab])

    // ブラウザの戻る/進むボタンの処理
    useEffect(() => {
        const handlePopState = () => {
            const hash = window.location.hash.slice(1)
            const validTabs = ['races', 'hit-races', 'accuracy', 'privacy', 'terms', 'contact']
            setActiveTab(validTabs.includes(hash) ? hash : 'races')
        }

        window.addEventListener('popstate', handlePopState)
        window.addEventListener('hashchange', handlePopState)

        return () => {
            window.removeEventListener('popstate', handlePopState)
            window.removeEventListener('hashchange', handlePopState)
        }
    }, [])

    // タブ切り替え関数（URLハッシュも更新）
    const handleTabChange = (tab) => {
        setActiveTab(tab)
        setIsMenuOpen(false) // タブ切り替え時にメニューを閉じる
        // URLハッシュを更新（ブラウザ履歴に追加）
        const newHash = `#${tab}`
        if (window.location.hash !== newHash) {
            window.history.pushState(null, '', newHash)
        }
    }

    // メニュー外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isMenuOpen && !event.target.closest('.menu-container')) {
                setIsMenuOpen(false)
            }
        }

        document.addEventListener('click', handleClickOutside)
        return () => document.removeEventListener('click', handleClickOutside)
    }, [isMenuOpen])

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

    // 実際のAPIからデータを取得
    useEffect(() => {
        const fetchRaceData = async () => {
            try {
                setLoading(true)
                setError(null)

                // 静的JSONファイルから読み込み（GitHub Pages対応）
                // ローカル開発時はpublic/data/races.json、本番はビルド後のdata/races.jsonから読み込み
                const apiUrl = import.meta.env.BASE_URL + 'data/races.json'

                const response = await fetchWithRetry(apiUrl)
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

                // データ更新時刻を保存
                if (result.scrapedAt) {
                    setLastUpdated(result.scrapedAt)
                }

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

    // 予想データをJSONファイルから読み込む
    const loadPredictionData = async (race) => {
        try {
            // 日本時間で今日の日付を取得
            const now = new Date()
            const jstOffset = 9 * 60 // JST is UTC+9
            const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000)
            const dateStr = jstDate.toISOString().split('T')[0]

            // 予想データを読み込み（リトライ機能付き）
            const predictionUrl = import.meta.env.BASE_URL + `data/predictions/${dateStr}.json`
            const response = await fetchWithRetry(predictionUrl, 2, 1000) // リトライ2回、1秒間隔

            const predictionData = await response.json()

            // レースIDを生成して該当する予想を探す
            const raceId = `${race.rawData?.date || dateStr}-${String(race.rawData?.placeCd || 0).padStart(2, '0')}-${String(race.raceNumber).padStart(2, '0')}`
            const racePrediction = predictionData.races.find(r => r.raceId === raceId)

            if (!racePrediction) {
                throw new Error(`レースID ${raceId} の予想が見つかりません`)
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

    const analyzeRace = async (race) => {
        setSelectedRace(race)
        setIsAnalyzing(true)
        setPrediction(null)

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

                const topPickPlayer = modelPrediction.players.find(
                    p => p.number === modelPrediction.topPick
                )
                const top3Players = modelPrediction.top3.map(num =>
                    modelPrediction.players.find(p => p.number === num)
                )

                const aiPrediction = {
                    topPick: topPickPlayer,
                    recommended: top3Players,
                    allPlayers: modelPrediction.players,
                    confidence: modelPrediction.confidence,
                    reasoning: modelPrediction.reasoning,
                    top3: modelPrediction.top3, // トップ3の艇番（number配列）
                    result: racePrediction.result, // レース結果
                    predictions: racePrediction.predictions // 全モデルの予想データ
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
                        <h1>BoatAI</h1>
                    </div>
                    <nav className="nav">
                        <button
                            className={`nav-btn ${activeTab === 'races' ? 'active' : ''}`}
                            onClick={() => handleTabChange('races')}
                        >
                            🏁 予想
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'hit-races' ? 'active' : ''}`}
                            onClick={() => handleTabChange('hit-races')}
                        >
                            ✅ 的中
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'accuracy' ? 'active' : ''}`}
                            onClick={() => handleTabChange('accuracy')}
                        >
                            📊 成績
                        </button>
                        <div className="menu-container">
                            <button
                                className="nav-btn menu-btn"
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                            >
                                ⋮
                            </button>
                            {isMenuOpen && (
                                <div className="submenu">
                                    <Link to="/how-to-use" className="submenu-item" onClick={() => setIsMenuOpen(false)}>
                                        📚 使い方
                                    </Link>
                                    <Link to="/blog" className="submenu-item" onClick={() => setIsMenuOpen(false)}>
                                        📝 ブログ
                                    </Link>
                                    <Link to="/faq" className="submenu-item" onClick={() => setIsMenuOpen(false)}>
                                        ❓ よくある質問
                                    </Link>
                                    <Link to="/about" className="submenu-item" onClick={() => setIsMenuOpen(false)}>
                                        ℹ️ サービスについて
                                    </Link>
                                </div>
                            )}
                        </div>
                    </nav>
                </div>
            </header>

            <div className="container">
                <main className="main-content">
                    {activeTab === 'privacy' ? (
                        <PrivacyPolicy />
                    ) : activeTab === 'terms' ? (
                        <Terms />
                    ) : activeTab === 'contact' ? (
                        <Contact />
                    ) : activeTab === 'accuracy' ? (
                        <AccuracyDashboard />
                    ) : activeTab === 'hit-races' ? (
                        <HitRaces
                            allVenuesData={allVenuesData}
                            analyzeRace={analyzeRace}
                            stadiumNames={stadiumNames}
                            fetchWithRetry={fetchWithRetry}
                            lastUpdated={lastUpdated}
                        />
                    ) : (
                        <>
                            <section className="race-list-section">
                                <h2>🏁 本日開催中のレース {getTodayDateShort()}</h2>
                                <UpdateStatus lastUpdated={lastUpdated} dataType="レースデータ" />

                                {loading ? (
                                    <div className="analyzing">
                                        <div className="spinner"></div>
                                        <p>レースデータを読み込み中...</p>
                                    </div>
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
                                                    {allVenuesData.map(venue => (
                                                        <option key={venue.placeCd} value={venue.placeCd}>
                                                            {venue.placeName} ({venue.races.length}レース)
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

                                    {selectedRace.rawData && selectedRace.rawData.placeCd && selectedRace.rawData.date && (
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
                                                href={`https://www.boatrace.jp/owpc/pc/race/racelist?rno=${selectedRace.raceNumber}&jcd=${String(selectedRace.rawData.placeCd).padStart(2, '0')}&hd=${selectedRace.rawData.date.replace(/-/g, '')}`}
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
                                    {prediction && !prediction.error && prediction.predictions && (
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
                                                                        volatility.recommendedModel === 'safe-bet' ? '#2e7d32' : '#667eea',
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

                                            {/* モデル選択ボタン */}
                                            <div style={{
                                                display: 'flex',
                                                gap: '0.75rem',
                                                marginBottom: '1.5rem',
                                                flexWrap: 'wrap'
                                            }}>
                                                <button
                                                    onClick={() => switchModel('standard')}
                                                    title="バランス型：的中率と配当のバランスを重視。全国勝率・当地成績・モーター性能を総合的に評価します。"
                                                    style={{
                                                        flex: '1',
                                                        minWidth: '140px',
                                                        padding: '0.75rem 1rem',
                                                        background: selectedModel === 'standard' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'white',
                                                        color: selectedModel === 'standard' ? 'white' : '#333',
                                                        border: selectedModel === 'standard' ? 'none' : '2px solid #e0e0e0',
                                                        borderRadius: '8px',
                                                        fontSize: '0.95rem',
                                                        fontWeight: '600',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.3s ease',
                                                        boxShadow: selectedModel === 'standard' ? '0 4px 12px rgba(102, 126, 234, 0.3)' : 'none'
                                                    }}
                                                >
                                                    ⚖️ スタンダード
                                                </button>
                                                <button
                                                    onClick={() => switchModel('safe-bet')}
                                                    title="安全型：的中率を最重視。1号艇とA級選手を優先し、堅いレースで力を発揮します。"
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
                                                    title="高配当型：大穴を狙って高配当を目指す。外枠の好モーターや展開の妙を重視し、荒れるレースで力を発揮します。"
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
                                        </>
                                    )}

                                    {isAnalyzing ? (
                                        <div className="analyzing">
                                            <div className="spinner"></div>
                                            <p>AIが分析中...</p>
                                            <p className="analyzing-detail">過去データ、モーター性能、気象条件を解析しています</p>
                                        </div>
                                    ) : prediction && prediction.error ? (
                                        <div className="prediction-error" style={{
                                            padding: '2rem',
                                            background: '#fff3cd',
                                            borderRadius: '12px',
                                            border: '2px solid #ffc107',
                                            textAlign: 'center'
                                        }}>
                                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                                            <h3 style={{ color: '#856404', marginBottom: '1rem' }}>予想データが利用できません</h3>
                                            <p style={{ color: '#856404', marginBottom: '1.5rem' }}>{prediction.errorMessage}</p>
                                            <button
                                                onClick={() => setPrediction(null)}
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
                                                戻る
                                            </button>
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

                                            {/* SNSシェアボタン */}
                                            <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                                                <SocialShareButtons
                                                    shareUrl="https://boat-ai.jp/"
                                                    title={(() => {
                                                        // レースIDから日付を抽出 (YYYY-MM-DD-PlaceCode-RaceNo)
                                                        const raceId = selectedRace?.id || '';
                                                        const dateParts = raceId.split('-').slice(0, 3);
                                                        const date = dateParts.length === 3 ? dateParts.join('-') : '';

                                                        return generatePredictionShareText({
                                                            venue: selectedRace?.venue || '不明',
                                                            raceNo: selectedRace?.raceNumber || '?',
                                                            date: date,
                                                            prediction: {
                                                                topPick: prediction.topPick.number,
                                                                top3: [1, 2, 3].map(i => prediction.allPlayers[i - 1]?.number).filter(Boolean),
                                                                aiScores: [prediction.topPick.aiScore]
                                                            }
                                                        }, selectedModel);
                                                    })()}
                                                    hashtags={['ボートレース', 'AI予想', 'BoatAI']}
                                                    size={40}
                                                />
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

                                            {/* レース結果セクション */}
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

                                                    {/* 的中判定 */}
                                                    <div className="accuracy-check">
                                                        {/* 単勝 */}
                                                        <div className="check-item">
                                                            {prediction.topPick.number === prediction.result.rank1 ? (
                                                                <div className="hit">
                                                                    ✅ 単勝的中！
                                                                    {prediction.result.payouts?.win?.[prediction.topPick.number] && (
                                                                        <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                                                            配当: {prediction.result.payouts.win[prediction.topPick.number]}円
                                                                        </span>
                                                                    )}
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
                                                                    {prediction.result.payouts?.place?.[prediction.topPick.number] && (
                                                                        <span style={{ marginLeft: '0.5rem', color: '#2196f3', fontWeight: 'bold' }}>
                                                                            配当: {prediction.result.payouts.place[prediction.topPick.number]}円
                                                                        </span>
                                                                    )}
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

                                                    {/* 予想と結果の比較 */}
                                                    <div className="comparison">
                                                        <h5>予想と結果の比較</h5>
                                                        <div className="comparison-grid">
                                                            <div className="comparison-item">
                                                                <div className="comparison-label">AI予想トップ3</div>
                                                                <div className="comparison-value">
                                                                    {prediction.top3.map((num, idx) => (
                                                                        <span key={idx} className="boat-badge">{num}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="comparison-item">
                                                                <div className="comparison-label">実際の結果</div>
                                                                <div className="comparison-value">
                                                                    <span className="boat-badge gold">{prediction.result.rank1}</span>
                                                                    <span className="boat-badge silver">{prediction.result.rank2}</span>
                                                                    <span className="boat-badge bronze">{prediction.result.rank3}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

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
                        </>
                    )}
                </main>
            </div>

            <footer className="footer">
                <p>※本サイトはAIによる予想を提供するものであり、的中を保証するものではありません</p>
                <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    marginTop: '0.75rem',
                    marginBottom: '0.75rem'
                }}>
                    <Link to="/blog" style={{ color: '#94a3b8', textDecoration: 'none' }}>ブログ</Link>
                    <Link to="/about" style={{ color: '#94a3b8', textDecoration: 'none' }}>About</Link>
                    <Link to="/faq" style={{ color: '#94a3b8', textDecoration: 'none' }}>FAQ</Link>
                    <a href="#privacy" style={{ color: '#94a3b8', textDecoration: 'none' }}>プライバシーポリシー</a>
                    <a href="#terms" style={{ color: '#94a3b8', textDecoration: 'none' }}>利用規約</a>
                    <a href="#contact" style={{ color: '#94a3b8', textDecoration: 'none' }}>お問い合わせ</a>
                </div>
                <p>&copy; 2025 BoatAI - All Rights Reserved</p>
            </footer>
        </div>
    )
}

export default App
