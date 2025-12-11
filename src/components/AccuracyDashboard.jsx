import { useState, useEffect } from 'react'
import './AccuracyDashboard.css'

function AccuracyDashboard() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true)
        // キャッシュバスティング: タイムスタンプをクエリパラメータに追加
        const summaryUrl = import.meta.env.BASE_URL + 'data/predictions/summary.json?t=' + Date.now()
        const response = await fetch(summaryUrl)

        if (!response.ok) {
          throw new Error('Summary data not available yet')
        }

        const data = await response.json()
        setSummary(data)
      } catch (err) {
        console.error('Failed to load accuracy summary:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchSummary()
  }, [])

  if (loading) {
    return (
      <div className="accuracy-dashboard">
        <h2>📊 AI予想的中率</h2>
        <div className="loading">的中率データを読み込み中...</div>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="accuracy-dashboard">
        <h2>📊 AI予想的中率</h2>
        <div className="error-message">
          的中率データはまだ利用できません。レース終了後に自動計算されます。
        </div>
      </div>
    )
  }

  const formatPercent = (rate) => (rate * 100).toFixed(1) + '%'
  const hasData = summary.overall.totalRaces > 0

  // 回収率の色を取得するヘルパー関数
  const getRecoveryRateColor = (actualRecovery, betType, hitRate, averageOdds) => {
    if (actualRecovery?.[betType]?.totalInvestment > 0) {
      const rate = actualRecovery[betType].recoveryRate
      if (rate >= 1.0) return '#10b981' // 緑
      if (rate >= 0.9) return '#f59e0b' // 黄色
      return '#ef4444' // 赤
    }

    // 実データがない場合は推定値で判定
    if (summary.yesterday.totalRaces > 0) {
      const estimatedRate = averageOdds * hitRate
      if (estimatedRate >= 1.0) return '#10b981'
      if (estimatedRate >= 0.9) return '#f59e0b'
      return '#ef4444'
    }

    return '#ef4444'
  }

  // 回収率の表示テキストを取得するヘルパー関数
  const getRecoveryRateDisplay = (actualRecovery, betType, hitRate, averageOdds) => {
    if (actualRecovery?.[betType]?.totalInvestment > 0) {
      // 実際の回収率を表示（*なし）
      return (actualRecovery[betType].recoveryRate * 100).toFixed(1) + '%'
    }

    if (summary.yesterday.totalRaces > 0) {
      // 推定値を表示（*あり）
      return (averageOdds * hitRate * 100).toFixed(1) + '%*'
    }

    return '-'
  }

  return (
    <div className="accuracy-dashboard">
      <h2>📊 AI予想的中率</h2>

      {!hasData ? (
        <div className="no-data-message">
          まだレース結果がありません。レース終了後にご確認ください！
        </div>
      ) : (
        <>
          {/* Performance Stats */}
          <div className="stats-grid">
            {/* Yesterday */}
            {summary.yesterday.totalRaces > 0 && (
              <div className="stat-card yesterday">
                <h3>前日 ({summary.yesterday.date})</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.yesterday.topPickHitRate)}</div>
                  <div className="stat-label">単勝的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.yesterday.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">複勝:</span>
                    <span className="detail-value">{formatPercent(summary.yesterday.topPickPlaceRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連複:</span>
                    <span className="detail-value">{formatPercent(summary.yesterday.top3HitRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連単:</span>
                    <span className="detail-value">{formatPercent(summary.yesterday.top3IncludedRate)}</span>
                  </div>
                  {summary.yesterday.actualRecovery && (
                    <>
                      <div className="detail-item" style={{marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb'}}>
                        <span className="detail-label">単勝回収率:</span>
                        <span className="detail-value" style={{color: summary.yesterday.actualRecovery.win.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(summary.yesterday.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">複勝回収率:</span>
                        <span className="detail-value" style={{color: summary.yesterday.actualRecovery.place.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(summary.yesterday.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">3連複回収率:</span>
                        <span className="detail-value" style={{color: summary.yesterday.actualRecovery.trifecta.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(summary.yesterday.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">3連単回収率:</span>
                        <span className="detail-value" style={{color: summary.yesterday.actualRecovery.trio.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(summary.yesterday.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* This Month */}
            {summary.thisMonth.totalRaces > 0 && (
              <div className="stat-card this-month">
                <h3>今月 ({summary.thisMonth.year}年{summary.thisMonth.month}月)</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.thisMonth.topPickHitRate)}</div>
                  <div className="stat-label">単勝的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.thisMonth.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">複勝:</span>
                    <span className="detail-value">{formatPercent(summary.thisMonth.topPickPlaceRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連複:</span>
                    <span className="detail-value">{formatPercent(summary.thisMonth.top3HitRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連単:</span>
                    <span className="detail-value">{formatPercent(summary.thisMonth.top3IncludedRate)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Last Month */}
            {summary.lastMonth.totalRaces > 0 && (
              <div className="stat-card last-month">
                <h3>先月 ({summary.lastMonth.year}年{summary.lastMonth.month}月)</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.lastMonth.topPickHitRate)}</div>
                  <div className="stat-label">単勝的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.lastMonth.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">複勝:</span>
                    <span className="detail-value">{formatPercent(summary.lastMonth.topPickPlaceRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連複:</span>
                    <span className="detail-value">{formatPercent(summary.lastMonth.top3HitRate)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">3連単:</span>
                    <span className="detail-value">{formatPercent(summary.lastMonth.top3IncludedRate)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Daily History */}
          {summary.dailyHistory && summary.dailyHistory.length > 0 && (
            <div className="daily-history">
              <h3>直近のパフォーマンス</h3>
              <div className="history-list">
                {summary.dailyHistory.slice(-7).reverse().map((day) => (
                  <div key={day.date} className="history-item">
                    <div className="history-date">{day.date}</div>
                    <div className="history-stats">
                      <span className="history-label">レース数:</span>
                      <span className="history-value">{day.totalRaces}</span>
                      <span className="history-label">単勝:</span>
                      <span className="history-value">{formatPercent(day.topPickHitRate)}</span>
                      <span className="history-label">複勝:</span>
                      <span className="history-value">{formatPercent(day.topPickPlaceRate)}</span>
                      <span className="history-label">3連複:</span>
                      <span className="history-value">{formatPercent(day.top3HitRate)}</span>
                      <span className="history-label">3連単:</span>
                      <span className="history-value">{formatPercent(day.top3IncludedRate)}</span>
                    </div>
                    {day.actualRecovery && (
                      <div className="history-recovery" style={{marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.5rem', fontSize: '0.85rem'}}>
                        <span style={{color: '#64748b'}}>単勝回収率:</span>
                        <span style={{fontWeight: '600', color: day.actualRecovery.win.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(day.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
                        </span>
                        <span style={{color: '#64748b'}}>複勝回収率:</span>
                        <span style={{fontWeight: '600', color: day.actualRecovery.place.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(day.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
                        </span>
                        <span style={{color: '#64748b'}}>3連複回収率:</span>
                        <span style={{fontWeight: '600', color: day.actualRecovery.trifecta.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(day.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
                        </span>
                        <span style={{color: '#64748b'}}>3連単回収率:</span>
                        <span style={{fontWeight: '600', color: day.actualRecovery.trio.recoveryRate >= 1.0 ? '#10b981' : '#ef4444'}}>
                          {(day.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="accuracy-info">
            <h4>💡 的中率について</h4>
            <ul>
              <li><strong>単勝:</strong> AI予想の本命（1位予想）が1着になった割合</li>
              <li><strong>複勝:</strong> AI予想の本命が3着以内に入った割合</li>
              <li><strong>3連複:</strong> AI予想のトップ3が実際の1-2-3着を全て含んでいた割合（順序不問）</li>
              <li><strong>3連単:</strong> AI予想のトップ3が実際の1-2-3着と順序も完全一致した割合</li>
              <li><strong>データ更新:</strong> レース終了後、自動的に的中率が計算されます</li>
            </ul>
          </div>

          {/* 回収率の目安 */}
          <div className="accuracy-info" style={{marginTop: '1.5rem'}}>
            <h4>📈 前日の的中率と回収率</h4>
            <p style={{fontSize: '0.9rem', color: '#1e293b', marginBottom: '1rem'}}>
              ※前日（{summary.yesterday.date}）のAI予想の実績データです。実際の配当データに基づく回収率を表示しています。
            </p>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', color: '#1e293b'}}>
                <thead>
                  <tr style={{backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1'}}>
                    <th style={{padding: '0.75rem', textAlign: 'left', color: '#0f172a', fontWeight: '700'}}>券種</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>本命の平均配当<br/><span style={{fontSize: '0.8rem', color: '#64748b', fontWeight: '400'}}>(参考値)</span></th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>必要な<br/>的中率</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>前日のAI<br/>的中率</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>前日の<br/>回収率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>単勝</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約3.0倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>33%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>
                      {summary.yesterday.totalRaces > 0 ? formatPercent(summary.yesterday.topPickHitRate) : '-'}
                    </td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: getRecoveryRateColor(summary.yesterday.actualRecovery, 'win', summary.yesterday.topPickHitRate, 3.0)}}>
                      {getRecoveryRateDisplay(summary.yesterday.actualRecovery, 'win', summary.yesterday.topPickHitRate, 3.0)}
                    </td>
                  </tr>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>複勝</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約1.5倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>67%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>
                      {summary.yesterday.totalRaces > 0 ? formatPercent(summary.yesterday.topPickPlaceRate) : '-'}
                    </td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: getRecoveryRateColor(summary.yesterday.actualRecovery, 'place', summary.yesterday.topPickPlaceRate, 1.5)}}>
                      {getRecoveryRateDisplay(summary.yesterday.actualRecovery, 'place', summary.yesterday.topPickPlaceRate, 1.5)}
                    </td>
                  </tr>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>3連複</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約15-20倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>5-7%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>
                      {summary.yesterday.totalRaces > 0 ? formatPercent(summary.yesterday.top3HitRate) : '-'}
                    </td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: getRecoveryRateColor(summary.yesterday.actualRecovery, 'trifecta', summary.yesterday.top3HitRate, 17.5)}}>
                      {getRecoveryRateDisplay(summary.yesterday.actualRecovery, 'trifecta', summary.yesterday.top3HitRate, 17.5)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>3連単</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約80-100倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>1-1.25%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>
                      {summary.yesterday.totalRaces > 0 ? formatPercent(summary.yesterday.top3IncludedRate) : '-'}
                    </td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: getRecoveryRateColor(summary.yesterday.actualRecovery, 'trio', summary.yesterday.top3IncludedRate, 90)}}>
                      {getRecoveryRateDisplay(summary.yesterday.actualRecovery, 'trio', summary.yesterday.top3IncludedRate, 90)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{fontSize: '0.85rem', color: '#1e293b', marginTop: '1rem', lineHeight: '1.6'}}>
              <strong style={{color: '#0f172a'}}>回収率について:</strong> 実際の配当データがある場合は実回収率を表示し、データがない場合は推定値（*印付き）を表示します。
              推定値は「平均配当 × 的中率」で計算した参考値です。
              競艇の控除率は約25%のため、完全ランダムに購入すると理論上の回収率は約75%です。
              回収率100%超えを目指すには、的中率だけでなく、高配当を狙う戦略も重要です。
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default AccuracyDashboard
