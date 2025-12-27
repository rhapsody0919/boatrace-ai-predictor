import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShareButton } from './ShareButton'
import { SocialShareButtons } from './SocialShareButtons'
import { shareHitRaceToX, generateHitRaceShareText } from '../utils/share'
import UpdateStatus from './UpdateStatus'
import LoadingScreen from './LoadingScreen'
import './HitRaces.css'

function HitRaces({ allVenuesData, analyzeRace, stadiumNames, fetchWithRetry, lastUpdated, onRefresh, isRefreshing }) {
    const navigate = useNavigate()
    const [hitRacesToday, setHitRacesToday] = useState([])
    const [hitRacesYesterday, setHitRacesYesterday] = useState([])
    const [hitRacesAll, setHitRacesAll] = useState([])
    const [showAllToday, setShowAllToday] = useState(false)
    const [showAllYesterday, setShowAllYesterday] = useState(false)
    const [showAllPeriod, setShowAllPeriod] = useState(false)
    const [loading, setLoading] = useState(true)
    const [selectedPeriod, setSelectedPeriod] = useState('today') // 'today', 'yesterday', 'all'
    const [selectedModel, setSelectedModel] = useState('standard') // 'standard', 'safeBet', 'upsetFocus'

    // 日付フォーマット関数（12/21(土)形式）
    const formatDateWithDay = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00+09:00') // JSTとして解釈
        const month = date.getMonth() + 1
        const day = date.getDate()
        const weekdays = ['日', '月', '火', '水', '木', '金', '土']
        const weekday = weekdays[date.getDay()]
        return `${month}/${day}(${weekday})`
    }

    // 今日と昨日の日付を取得
    const getJSTDate = () => {
        const now = new Date()
        const jstOffset = 9 * 60 // JST is UTC+9
        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000)
        const todayStr = jstNow.toISOString().split('T')[0]
        const yesterday = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000)
        const yesterdayStr = yesterday.toISOString().split('T')[0]
        return { todayStr, yesterdayStr }
    }

    const { todayStr, yesterdayStr } = getJSTDate()

    // 的中レースを読み込む
    useEffect(() => {
        const fetchHitRaces = async () => {
            try {
                setLoading(true)
                // 日本時間で今日と昨日の日付を取得
                const now = new Date()
                const jstOffset = 9 * 60 // JST is UTC+9
                const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000)

                // 今日と昨日の予想データを読み込む
                const loadDayPredictions = async (dateStr) => {
                    try {
                        const predictionUrl = import.meta.env.BASE_URL + `data/predictions/${dateStr}.json`
                        const response = await fetchWithRetry(predictionUrl, 2, 1000)
                        const data = await response.json()
                        return data.races || []
                    } catch (error) {
                        console.warn(`予想データ読み込みエラー (${dateStr}):`, error)
                        return []
                    }
                }

                const [todayPredictions, yesterdayPredictions] = await Promise.all([
                    loadDayPredictions(todayStr),
                    loadDayPredictions(yesterdayStr)
                ])

                // 的中レースを抽出する関数（モデル対応）
                const extractHitRaces = (predictions, modelKey) => {
                    return predictions
                        .filter(race => {
                            // レース結果が確定しているものだけ
                            if (!race.result || !race.result.finished) return false

                            // モデル別の予想データを取得（後方互換性あり）
                            const prediction = race.predictions?.[modelKey] || race.prediction
                            if (!prediction) return false

                            // 的中判定: 単勝、複勝、3連複、3連単のいずれかが的中していれば抽出
                            const topPick = prediction.topPick
                            const top3 = prediction.top3
                            const result = race.result

                            const isWinHit = topPick === result.rank1
                            const isPlaceHit = topPick === result.rank1 || topPick === result.rank2
                            const is3FukuHit = top3.includes(result.rank1) &&
                                top3.includes(result.rank2) &&
                                top3.includes(result.rank3)
                            const is3TanHit = top3[0] === result.rank1 &&
                                top3[1] === result.rank2 &&
                                top3[2] === result.rank3

                            return isWinHit || isPlaceHit || is3FukuHit || is3TanHit
                        })
                        .map(race => {
                            // モデル別の予想データを取得（後方互換性あり）
                            const prediction = race.predictions?.[modelKey] || race.prediction

                            // 的中情報と配当を計算
                            const topPick = prediction.topPick
                            const top3 = prediction.top3
                            const result = race.result
                            const payouts = result.payouts || {}

                            const hitTypes = []
                            let totalPayout = 0

                            // 単勝
                            if (topPick === result.rank1) {
                                const payout = payouts.win?.[topPick] || 0
                                hitTypes.push({ type: '単勝', payout })
                                totalPayout += payout
                            }

                            // 複勝
                            if (topPick === result.rank1 || topPick === result.rank2) {
                                const payout = payouts.place?.[topPick] || 0
                                hitTypes.push({ type: '複勝', payout })
                                totalPayout += payout
                            }

                            // 3連複
                            if (top3.includes(result.rank1) &&
                                top3.includes(result.rank2) &&
                                top3.includes(result.rank3)) {
                                const sorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b)
                                const key = sorted.join('-')
                                const payout = payouts.trifecta?.[key] || 0
                                hitTypes.push({ type: '3連複', payout })
                                totalPayout += payout
                            }

                            // 3連単
                            if (top3[0] === result.rank1 &&
                                top3[1] === result.rank2 &&
                                top3[2] === result.rank3) {
                                const key = `${result.rank1}-${result.rank2}-${result.rank3}`
                                const payout = payouts.trio?.[key] || 0
                                hitTypes.push({ type: '3連単', payout })
                                totalPayout += payout
                            }

                            // レースIDからボートレース場と時刻を抽出
                            // RaceIdフォーマット: YYYY-MM-DD-PlaceCode-RaceNo
                            const parts = race.raceId.split('-')
                            const date = `${parts[0]}-${parts[1]}-${parts[2]}`
                            const placeCode = parts[3]
                            const raceNo = parts[4]

                            return {
                                raceId: race.raceId,
                                venue: stadiumNames[parseInt(placeCode)] || `${placeCode}番`,
                                raceNumber: parseInt(raceNo),
                                date,
                                placeCode: parseInt(placeCode),
                                hitTypes,
                                totalPayout,
                                prediction,
                                result: race.result,
                                modelKey // モデル情報を追加
                            }
                        })
                        .sort((a, b) => b.totalPayout - a.totalPayout) // 配当額が高い順
                }

                setHitRacesToday(extractHitRaces(todayPredictions, selectedModel))
                setHitRacesYesterday(extractHitRaces(yesterdayPredictions, selectedModel))

                // 全期間のデータを読み込む（過去14日分）
                const allHitRaces = []
                for (let i = 0; i < 14; i++) {
                    const date = new Date(jstNow.getTime() - i * 24 * 60 * 60 * 1000)
                    const dateStr = date.toISOString().split('T')[0]
                    const predictions = await loadDayPredictions(dateStr)
                    const hits = extractHitRaces(predictions, selectedModel)
                    allHitRaces.push(...hits)
                }
                setHitRacesAll(allHitRaces)
            } catch (error) {
                console.error('的中レース読み込みエラー:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchHitRaces()
    }, [stadiumNames, fetchWithRetry, selectedModel])

    const handleCardClick = (hitRace) => {
        const venueData = allVenuesData.find(v => v.placeCd === hitRace.placeCode)
        if (venueData) {
            const race = venueData.races.find(r => r.raceNo === hitRace.raceNumber)
            if (race) {
                const formattedRace = {
                    id: `${race.date}-${race.placeCd}-${race.raceNo}`,
                    venue: venueData.placeName,
                    raceNumber: race.raceNo,
                    startTime: race.startTime || '未定',
                    weather: race.weather || '不明',
                    wave: race.waveHeight || 0,
                    wind: race.windVelocity || 0,
                    rawData: race
                }
                analyzeRace(formattedRace)
                // トップページに移動
                navigate('/')
            }
        }
    }

    // ボートレース場別の統計を計算
    const calculateVenueStats = () => {
        let hitRaces = []
        if (selectedPeriod === 'today') {
            hitRaces = hitRacesToday
        } else if (selectedPeriod === 'yesterday') {
            hitRaces = hitRacesYesterday
        } else {
            hitRaces = hitRacesAll
        }

        // ボートレース場ごとに集計
        const venueStats = {}
        hitRaces.forEach(race => {
            const venue = race.venue
            if (!venueStats[venue]) {
                venueStats[venue] = {
                    venue,
                    hitCount: 0,
                    totalPayout: 0
                }
            }
            venueStats[venue].hitCount++
            venueStats[venue].totalPayout += race.totalPayout
        })

        // 配列に変換して的中数でソート
        return Object.values(venueStats).sort((a, b) => b.hitCount - a.hitCount)
    }

    const venueStats = calculateVenueStats()

    if (loading) {
        return (
            <LoadingScreen
                title="的中レースを読み込み中..."
                description="過去14日分のデータを分析しています"
            />
        )
    }

    if (hitRacesToday.length === 0 && hitRacesYesterday.length === 0) {
        return (
            <div className="no-data-container">
                <div className="icon">🎯</div>
                <h2>的中レースはまだありません</h2>
                <p>レース結果が確定すると、ここに的中レースが表示されます。</p>
            </div>
        )
    }

    return (
        <div>
            {/* ボートレース場別統計セクション */}
            <section className="venue-stats-section">
                <h2>📊 ボートレース場別の的中実績</h2>
                <UpdateStatus
                    lastUpdated={lastUpdated}
                    dataType="予想データ"
                    onRefresh={onRefresh}
                    isRefreshing={isRefreshing}
                />

                {/* 期間選択タブ */}
                <div className="period-selector">
                    <button
                        onClick={() => setSelectedPeriod('today')}
                        className={selectedPeriod === 'today' ? 'active' : ''}
                    >
                        今日
                    </button>
                    <button
                        onClick={() => setSelectedPeriod('yesterday')}
                        className={selectedPeriod === 'yesterday' ? 'active' : ''}
                    >
                        昨日
                    </button>
                    <button
                        onClick={() => setSelectedPeriod('all')}
                        className={selectedPeriod === 'all' ? 'active' : ''}
                    >
                        全期間（14日間）
                    </button>
                </div>

                {/* モデル選択タブ */}
                <div className="model-selector">
                    <button
                        onClick={() => setSelectedModel('standard')}
                        className={selectedModel === 'standard' ? 'active standard' : ''}
                    >
                        スタンダード
                    </button>
                    <button
                        onClick={() => setSelectedModel('safeBet')}
                        className={selectedModel === 'safeBet' ? 'active safe-bet' : ''}
                    >
                        本命狙い
                    </button>
                    <button
                        onClick={() => setSelectedModel('upsetFocus')}
                        className={selectedModel === 'upsetFocus' ? 'active upset-focus' : ''}
                    >
                        穴狙い
                    </button>
                </div>

                {/* 統計テーブル */}
                {venueStats.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="venue-stats-table">
                            <thead>
                                <tr>
                                    <th>順位</th>
                                    <th>ボートレース場</th>
                                    <th className="text-right">的中数</th>
                                    <th className="text-right">総配当</th>
                                </tr>
                            </thead>
                            <tbody>
                                {venueStats.map((stat, index) => (
                                    <tr key={stat.venue} className={index < 3 ? 'top-3' : ''}>
                                        <td className={`rank-cell ${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}`}>
                                            {index === 0 && '🏆'}
                                            {index === 1 && '🥈'}
                                            {index === 2 && '🥉'}
                                            {index > 2 && (index + 1)}
                                        </td>
                                        <td className="venue-name">
                                            {stat.venue}
                                        </td>
                                        <td className="hit-count text-right">
                                            {stat.hitCount}レース
                                        </td>
                                        <td className="total-payout text-right">
                                            {stat.totalPayout.toLocaleString()}円
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                        <p>選択期間に的中レースがありません</p>
                    </div>
                )}
            </section>

            {/* 今日の的中レース */}
            {hitRacesToday.length > 0 && selectedPeriod === 'today' && (
                <section className="hit-races-section today">
                    <h2>📅 今日の的中レース {formatDateWithDay(todayStr)} ({hitRacesToday.length}レース)</h2>
                    <div className="race-cards-grid">
                        {(showAllToday ? hitRacesToday : hitRacesToday.slice(0, 8)).map(hitRace => (
                            <div
                                key={hitRace.raceId}
                                className="race-card clickable"
                                onClick={() => handleCardClick(hitRace)}
                                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                                <div className="race-card-header">
                                    <div>
                                        <div className="race-card-venue">
                                            {hitRace.venue}
                                        </div>
                                        <div className="race-card-number">
                                            {hitRace.raceNumber}R
                                        </div>
                                    </div>
                                    <div className="hit-badge">
                                        的中
                                    </div>
                                </div>

                                <div className="hit-types-list">
                                    {hitRace.hitTypes.map((hit, idx) => (
                                        <div key={idx} className="hit-type-item">
                                            <span className="hit-type-label">✅ {hit.type}</span>
                                            <span className="hit-type-payout">{hit.payout.toLocaleString()}円</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="total-payout-section">
                                    <span className="total-payout-label">合計配当</span>
                                    <span className="total-payout-value">
                                        {hitRace.totalPayout.toLocaleString()}円
                                    </span>
                                </div>

                                {/* SNSシェアボタン */}
                                <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <SocialShareButtons
                                        shareUrl="https://boat-ai.jp/"
                                        title={generateHitRaceShareText({
                                            venue: hitRace.venue,
                                            raceNo: hitRace.raceNumber,
                                            date: hitRace.date,
                                            prediction: {
                                                top3: hitRace.prediction?.top3 || []
                                            },
                                            result: [
                                                hitRace.result?.rank1,
                                                hitRace.result?.rank2,
                                                hitRace.result?.rank3
                                            ].filter(Boolean),
                                            totalPayout: hitRace.totalPayout,
                                            hitTypes: hitRace.hitTypes || []
                                        }, selectedModel)}
                                        hashtags={['ボートレース', '的中', 'BoatAI']}
                                        size={36}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    {hitRacesToday.length > 8 && (
                        <button
                            onClick={() => setShowAllToday(!showAllToday)}
                            className="show-more-button"
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                            {showAllToday ? '閉じる ▲' : `もっと見る (残り${hitRacesToday.length - 8}レース) ▼`}
                        </button>
                    )}

                    {/* 統計情報 */}
                    <div className="stats-box">
                        <div className="stats-flex">
                            <div className="stat-item">
                                <div className="stat-label">
                                    的中数
                                </div>
                                <div className="stat-value">
                                    {hitRacesToday.length}
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-label">
                                    総配当
                                </div>
                                <div className="stat-value">
                                    {hitRacesToday.reduce((sum, race) => sum + race.totalPayout, 0).toLocaleString()}円
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* 昨日の的中レース */}
            {hitRacesYesterday.length > 0 && selectedPeriod === 'yesterday' && (
                <section className="hit-races-section yesterday">
                    <h2>📅 昨日の的中レース {formatDateWithDay(yesterdayStr)} ({hitRacesYesterday.length}レース)</h2>
                    <div className="race-cards-grid">
                        {(showAllYesterday ? hitRacesYesterday : hitRacesYesterday.slice(0, 8)).map(hitRace => (
                            <div
                                key={hitRace.raceId}
                                className="race-card yesterday"
                            >
                                <div className="race-card-header">
                                    <div>
                                        <div className="race-card-venue">
                                            {hitRace.venue}
                                        </div>
                                        <div className="race-card-number">
                                            {hitRace.raceNumber}R
                                        </div>
                                    </div>
                                    <div className="hit-badge yesterday">
                                        的中
                                    </div>
                                </div>

                                <div className="hit-types-list">
                                    {hitRace.hitTypes.map((hit, idx) => (
                                        <div key={idx} className="hit-type-item">
                                            <span className="hit-type-label">✅ {hit.type}</span>
                                            <span className="hit-type-payout">{hit.payout.toLocaleString()}円</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="total-payout-section">
                                    <span className="total-payout-label">合計配当</span>
                                    <span className="total-payout-value">
                                        {hitRace.totalPayout.toLocaleString()}円
                                    </span>
                                </div>

                                {/* SNSシェアボタン */}
                                <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <SocialShareButtons
                                        shareUrl="https://boat-ai.jp/"
                                        title={generateHitRaceShareText({
                                            venue: hitRace.venue,
                                            raceNo: hitRace.raceNumber,
                                            date: hitRace.date,
                                            prediction: {
                                                top3: hitRace.prediction?.top3 || []
                                            },
                                            result: [
                                                hitRace.result?.rank1,
                                                hitRace.result?.rank2,
                                                hitRace.result?.rank3
                                            ].filter(Boolean),
                                            totalPayout: hitRace.totalPayout,
                                            hitTypes: hitRace.hitTypes || []
                                        }, selectedModel)}
                                        hashtags={['ボートレース', '的中', 'BoatAI']}
                                        size={36}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    {hitRacesYesterday.length > 8 && (
                        <button
                            onClick={() => setShowAllYesterday(!showAllYesterday)}
                            className="show-more-button yesterday"
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                            {showAllYesterday ? '閉じる ▲' : `もっと見る (残り${hitRacesYesterday.length - 8}レース) ▼`}
                        </button>
                    )}

                    {/* 統計情報 */}
                    <div className="stats-box">
                        <div className="stats-flex">
                            <div className="stat-item">
                                <div className="stat-label">
                                    的中数
                                </div>
                                <div className="stat-value">
                                    {hitRacesYesterday.length}
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-label">
                                    総配当
                                </div>
                                <div className="stat-value">
                                    {hitRacesYesterday.reduce((sum, race) => sum + race.totalPayout, 0).toLocaleString()}円
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* 全期間の的中レース */}
            {hitRacesAll.length > 0 && selectedPeriod === 'all' && (
                <section className="hit-races-section all">
                    <h2>📅 過去14日間の的中レース ({hitRacesAll.length}レース)</h2>
                    <div className="race-cards-grid">
                        {(showAllPeriod ? hitRacesAll : hitRacesAll.slice(0, 12)).map(hitRace => (
                            <div
                                key={hitRace.raceId}
                                className={`race-card ${hitRace.date === new Date().toISOString().split('T')[0] ? 'today' : 'yesterday'}`}
                                onClick={() => handleCardClick(hitRace)}
                                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                                <div className="race-card-header">
                                    <div>
                                        <div className="race-card-venue">
                                            {hitRace.venue}
                                        </div>
                                        <div className="race-card-number">
                                            {hitRace.raceNumber}R
                                        </div>
                                    </div>
                                    <div className="hit-badge">
                                        的中
                                    </div>
                                </div>

                                <div className="race-card-date" style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                    {hitRace.date}
                                </div>

                                <div className="hit-types-list">
                                    {hitRace.hitTypes.map((hit, idx) => (
                                        <div key={idx} className="hit-type-item">
                                            <span className="hit-type-label">✅ {hit.type}</span>
                                            <span className="hit-type-payout">{hit.payout.toLocaleString()}円</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="total-payout-section">
                                    <span className="total-payout-label">合計配当</span>
                                    <span className="total-payout-value">
                                        {hitRace.totalPayout.toLocaleString()}円
                                    </span>
                                </div>

                                {/* SNSシェアボタン */}
                                <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <SocialShareButtons
                                        shareUrl="https://boat-ai.jp/"
                                        title={generateHitRaceShareText({
                                            venue: hitRace.venue,
                                            raceNo: hitRace.raceNumber,
                                            date: hitRace.date,
                                            prediction: {
                                                top3: hitRace.prediction?.top3 || []
                                            },
                                            result: [
                                                hitRace.result?.rank1,
                                                hitRace.result?.rank2,
                                                hitRace.result?.rank3
                                            ].filter(Boolean),
                                            totalPayout: hitRace.totalPayout,
                                            hitTypes: hitRace.hitTypes || []
                                        }, selectedModel)}
                                        hashtags={['ボートレース', '的中', 'BoatAI']}
                                        size={36}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    {hitRacesAll.length > 12 && (
                        <button
                            onClick={() => setShowAllPeriod(!showAllPeriod)}
                            className="show-more-button"
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                            {showAllPeriod ? '閉じる ▲' : `もっと見る (残り${hitRacesAll.length - 12}レース) ▼`}
                        </button>
                    )}

                    {/* 統計情報 */}
                    <div className="stats-box">
                        <div className="stats-flex">
                            <div className="stat-item">
                                <div className="stat-label">
                                    的中数
                                </div>
                                <div className="stat-value">
                                    {hitRacesAll.length}
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-label">
                                    総配当
                                </div>
                                <div className="stat-value">
                                    {hitRacesAll.reduce((sum, race) => sum + race.totalPayout, 0).toLocaleString()}円
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}
        </div>
    )
}

export default HitRaces
