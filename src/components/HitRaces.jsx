import { useState, useEffect } from 'react'

function HitRaces({ allVenuesData, analyzeRace, stadiumNames, fetchWithRetry }) {
  const [hitRacesToday, setHitRacesToday] = useState([])
  const [hitRacesYesterday, setHitRacesYesterday] = useState([])
  const [hitRacesAll, setHitRacesAll] = useState([])
  const [showAllToday, setShowAllToday] = useState(false)
  const [showAllYesterday, setShowAllYesterday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState('today') // 'today', 'yesterday', 'all'

  // 的中レースを読み込む
  useEffect(() => {
    const fetchHitRaces = async () => {
      try {
        setLoading(true)
        // 日本時間で今日と昨日の日付を取得
        const now = new Date()
        const jstOffset = 9 * 60 // JST is UTC+9
        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000)

        const todayStr = jstNow.toISOString().split('T')[0]
        const yesterday = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000)
        const yesterdayStr = yesterday.toISOString().split('T')[0]

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

        // 的中レースを抽出する関数
        const extractHitRaces = (predictions) => {
          return predictions
            .filter(race => {
              // レース結果が確定しているものだけ
              if (!race.result || !race.result.finished) return false

              // 的中判定: 単勝、複勝、3連複、3連単のいずれかが的中していれば抽出
              const topPick = race.prediction.topPick
              const top3 = race.prediction.top3
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
              // 的中情報と配当を計算
              const topPick = race.prediction.topPick
              const top3 = race.prediction.top3
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

              // レースIDから競艇場と時刻を抽出
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
                prediction: race.prediction,
                result: race.result
              }
            })
            .sort((a, b) => b.totalPayout - a.totalPayout) // 配当額が高い順
        }

        setHitRacesToday(extractHitRaces(todayPredictions))
        setHitRacesYesterday(extractHitRaces(yesterdayPredictions))

        // 全期間のデータを読み込む（過去14日分）
        const allHitRaces = []
        for (let i = 0; i < 14; i++) {
          const date = new Date(jstNow.getTime() - i * 24 * 60 * 60 * 1000)
          const dateStr = date.toISOString().split('T')[0]
          const predictions = await loadDayPredictions(dateStr)
          const hits = extractHitRaces(predictions)
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
  }, [stadiumNames, fetchWithRetry])

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
        // レースタブに切り替え
        window.location.hash = '#races'
      }
    }
  }

  // 競艇場別の統計を計算
  const calculateVenueStats = () => {
    let hitRaces = []
    if (selectedPeriod === 'today') {
      hitRaces = hitRacesToday
    } else if (selectedPeriod === 'yesterday') {
      hitRaces = hitRacesYesterday
    } else {
      hitRaces = hitRacesAll
    }

    // 競艇場ごとに集計
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
      <div style={{padding: '2rem', textAlign: 'center'}}>
        <div className="spinner"></div>
        <p>的中レースを読み込み中...</p>
      </div>
    )
  }

  if (hitRacesToday.length === 0 && hitRacesYesterday.length === 0) {
    return (
      <div style={{
        padding: '3rem 2rem',
        textAlign: 'center',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <div style={{fontSize: '3rem', marginBottom: '1rem'}}>🎯</div>
        <h2 style={{color: '#64748b', marginBottom: '0.5rem'}}>的中レースはまだありません</h2>
        <p style={{color: '#94a3b8'}}>レース結果が確定すると、ここに的中レースが表示されます。</p>
      </div>
    )
  }

  return (
    <div>
      {/* 競艇場別統計セクション */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
          📊 競艇場別の的中実績
        </h2>

        {/* 期間選択タブ */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          borderBottom: '2px solid #e2e8f0',
          paddingBottom: '0'
        }}>
          <button
            onClick={() => setSelectedPeriod('today')}
            style={{
              padding: '0.75rem 1.5rem',
              background: selectedPeriod === 'today' ? '#667eea' : 'transparent',
              color: selectedPeriod === 'today' ? 'white' : '#64748b',
              border: 'none',
              borderBottom: selectedPeriod === 'today' ? '3px solid #667eea' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: selectedPeriod === 'today' ? 'bold' : 'normal',
              fontSize: '1rem',
              transition: 'all 0.2s'
            }}
          >
            今日
          </button>
          <button
            onClick={() => setSelectedPeriod('yesterday')}
            style={{
              padding: '0.75rem 1.5rem',
              background: selectedPeriod === 'yesterday' ? '#667eea' : 'transparent',
              color: selectedPeriod === 'yesterday' ? 'white' : '#64748b',
              border: 'none',
              borderBottom: selectedPeriod === 'yesterday' ? '3px solid #667eea' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: selectedPeriod === 'yesterday' ? 'bold' : 'normal',
              fontSize: '1rem',
              transition: 'all 0.2s'
            }}
          >
            昨日
          </button>
          <button
            onClick={() => setSelectedPeriod('all')}
            style={{
              padding: '0.75rem 1.5rem',
              background: selectedPeriod === 'all' ? '#667eea' : 'transparent',
              color: selectedPeriod === 'all' ? 'white' : '#64748b',
              border: 'none',
              borderBottom: selectedPeriod === 'all' ? '3px solid #667eea' : '3px solid transparent',
              cursor: 'pointer',
              fontWeight: selectedPeriod === 'all' ? 'bold' : 'normal',
              fontSize: '1rem',
              transition: 'all 0.2s'
            }}
          >
            全期間（14日間）
          </button>
        </div>

        {/* 統計テーブル */}
        {venueStats.length > 0 ? (
          <div style={{overflowX: 'auto'}}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.95rem'
            }}>
              <thead>
                <tr style={{background: '#f8fafc', borderBottom: '2px solid #e2e8f0'}}>
                  <th style={{padding: '1rem', textAlign: 'left', fontWeight: 'bold', color: '#1e293b'}}>順位</th>
                  <th style={{padding: '1rem', textAlign: 'left', fontWeight: 'bold', color: '#1e293b'}}>競艇場</th>
                  <th style={{padding: '1rem', textAlign: 'right', fontWeight: 'bold', color: '#1e293b'}}>的中数</th>
                  <th style={{padding: '1rem', textAlign: 'right', fontWeight: 'bold', color: '#1e293b'}}>総配当</th>
                </tr>
              </thead>
              <tbody>
                {venueStats.map((stat, index) => (
                  <tr key={stat.venue} style={{
                    borderBottom: '1px solid #e2e8f0',
                    transition: 'background 0.2s',
                    background: index < 3 ? 'rgba(102, 126, 234, 0.05)' : 'white'
                  }}>
                    <td style={{padding: '1rem', textAlign: 'left'}}>
                      {index === 0 && '🏆'}
                      {index === 1 && '🥈'}
                      {index === 2 && '🥉'}
                      {index > 2 && (index + 1)}
                    </td>
                    <td style={{padding: '1rem', textAlign: 'left', fontWeight: '500', color: '#1e293b'}}>
                      {stat.venue}
                    </td>
                    <td style={{padding: '1rem', textAlign: 'right', fontWeight: 'bold', color: '#667eea'}}>
                      {stat.hitCount}レース
                    </td>
                    <td style={{padding: '1rem', textAlign: 'right', fontWeight: 'bold', color: '#dc2626'}}>
                      {stat.totalPayout.toLocaleString()}円
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{padding: '2rem', textAlign: 'center', color: '#64748b'}}>
            <p>選択期間に的中レースがありません</p>
          </div>
        )}
      </section>

      {/* 今日の的中レース */}
      {hitRacesToday.length > 0 && (
        <section style={{
          marginBottom: '2rem',
          padding: '1.5rem',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{color: 'white', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            📅 今日の的中レース ({hitRacesToday.length}レース)
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem'
          }}>
            {(showAllToday ? hitRacesToday : hitRacesToday.slice(0, 8)).map(hitRace => (
              <div
                key={hitRace.raceId}
                style={{
                  background: 'white',
                  borderRadius: '8px',
                  padding: '1rem',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                }}
                onClick={() => handleCardClick(hitRace)}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem'}}>
                  <div>
                    <div style={{fontWeight: 'bold', fontSize: '1.1rem', color: '#1e293b'}}>
                      {hitRace.venue}
                    </div>
                    <div style={{fontSize: '0.9rem', color: '#64748b'}}>
                      {hitRace.raceNumber}R
                    </div>
                  </div>
                  <div style={{
                    background: '#22c55e',
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    fontWeight: 'bold'
                  }}>
                    的中
                  </div>
                </div>

                <div style={{marginBottom: '0.75rem'}}>
                  {hitRace.hitTypes.map((hit, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '0.4rem 0',
                      borderBottom: idx < hitRace.hitTypes.length - 1 ? '1px solid #e2e8f0' : 'none'
                    }}>
                      <span style={{color: '#475569', fontWeight: '500'}}>✅ {hit.type}</span>
                      <span style={{color: '#2563eb', fontWeight: 'bold'}}>{hit.payout.toLocaleString()}円</span>
                    </div>
                  ))}
                </div>

                <div style={{
                  borderTop: '2px solid #e2e8f0',
                  paddingTop: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{fontWeight: 'bold', color: '#1e293b'}}>合計配当</span>
                  <span style={{
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    color: '#dc2626'
                  }}>
                    {hitRace.totalPayout.toLocaleString()}円
                  </span>
                </div>
              </div>
            ))}
          </div>

          {hitRacesToday.length > 8 && (
            <button
              onClick={() => setShowAllToday(!showAllToday)}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                width: '100%',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              {showAllToday ? '閉じる ▲' : `もっと見る (残り${hitRacesToday.length - 8}レース) ▼`}
            </button>
          )}

          {/* 統計情報 */}
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '8px',
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-around',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', marginBottom: '0.25rem'}}>
                  的中数
                </div>
                <div style={{fontSize: '1.8rem', fontWeight: 'bold', color: 'white'}}>
                  {hitRacesToday.length}
                </div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', marginBottom: '0.25rem'}}>
                  総配当
                </div>
                <div style={{fontSize: '1.8rem', fontWeight: 'bold', color: 'white'}}>
                  {hitRacesToday.reduce((sum, race) => sum + race.totalPayout, 0).toLocaleString()}円
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 昨日の的中レース */}
      {hitRacesYesterday.length > 0 && (
        <section style={{
          padding: '1.5rem',
          background: 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{color: 'white', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            📅 昨日の的中レース ({hitRacesYesterday.length}レース)
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem'
          }}>
            {(showAllYesterday ? hitRacesYesterday : hitRacesYesterday.slice(0, 8)).map(hitRace => (
              <div
                key={hitRace.raceId}
                style={{
                  background: 'white',
                  borderRadius: '8px',
                  padding: '1rem',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  opacity: 0.95
                }}
              >
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem'}}>
                  <div>
                    <div style={{fontWeight: 'bold', fontSize: '1.1rem', color: '#1e293b'}}>
                      {hitRace.venue}
                    </div>
                    <div style={{fontSize: '0.9rem', color: '#64748b'}}>
                      {hitRace.raceNumber}R
                    </div>
                  </div>
                  <div style={{
                    background: '#94a3b8',
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    fontWeight: 'bold'
                  }}>
                    的中
                  </div>
                </div>

                <div style={{marginBottom: '0.75rem'}}>
                  {hitRace.hitTypes.map((hit, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '0.4rem 0',
                      borderBottom: idx < hitRace.hitTypes.length - 1 ? '1px solid #e2e8f0' : 'none'
                    }}>
                      <span style={{color: '#475569', fontWeight: '500'}}>✅ {hit.type}</span>
                      <span style={{color: '#2563eb', fontWeight: 'bold'}}>{hit.payout.toLocaleString()}円</span>
                    </div>
                  ))}
                </div>

                <div style={{
                  borderTop: '2px solid #e2e8f0',
                  paddingTop: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{fontWeight: 'bold', color: '#1e293b'}}>合計配当</span>
                  <span style={{
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    color: '#dc2626'
                  }}>
                    {hitRace.totalPayout.toLocaleString()}円
                  </span>
                </div>
              </div>
            ))}
          </div>

          {hitRacesYesterday.length > 8 && (
            <button
              onClick={() => setShowAllYesterday(!showAllYesterday)}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: 'white',
                color: '#64748b',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                width: '100%',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              {showAllYesterday ? '閉じる ▲' : `もっと見る (残り${hitRacesYesterday.length - 8}レース) ▼`}
            </button>
          )}

          {/* 統計情報 */}
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '8px',
            backdropFilter: 'blur(10px)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-around',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', marginBottom: '0.25rem'}}>
                  的中数
                </div>
                <div style={{fontSize: '1.8rem', fontWeight: 'bold', color: 'white'}}>
                  {hitRacesYesterday.length}
                </div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '0.9rem', color: 'rgba(255,255,255,0.9)', marginBottom: '0.25rem'}}>
                  総配当
                </div>
                <div style={{fontSize: '1.8rem', fontWeight: 'bold', color: 'white'}}>
                  {hitRacesYesterday.reduce((sum, race) => sum + race.totalPayout, 0).toLocaleString()}円
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
