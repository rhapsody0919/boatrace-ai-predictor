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
        const summaryUrl = import.meta.env.BASE_URL + 'data/predictions/summary.json'
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
            <h4>📈 回収率の目安（参考値）</h4>
            <p style={{fontSize: '0.9rem', color: '#1e293b', marginBottom: '1rem'}}>
              ※以下は本命買いを想定した一般的な目安です。実際のオッズは人気度や状況により変動します。
            </p>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', color: '#1e293b'}}>
                <thead>
                  <tr style={{backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1'}}>
                    <th style={{padding: '0.75rem', textAlign: 'left', color: '#0f172a', fontWeight: '700'}}>券種</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>本命の平均配当<br/><span style={{fontSize: '0.8rem', color: '#64748b', fontWeight: '400'}}>(参考値)</span></th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>必要な<br/>的中率</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>現在のAI<br/>的中率</th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>回収率<br/><span style={{fontSize: '0.8rem', color: '#64748b', fontWeight: '400'}}>(実際/推定)</span></th>
                    <th style={{padding: '0.75rem', textAlign: 'center', color: '#0f172a', fontWeight: '700'}}>評価</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>単勝</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約3.0倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>33%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>{summary.thisMonth.totalRaces > 0 ? formatPercent(summary.thisMonth.topPickHitRate) : '-'}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: summary.overall.actualRecovery?.win?.totalInvestment > 0 ? (summary.overall.actualRecovery.win.recoveryRate >= 1.0 ? '#10b981' : summary.overall.actualRecovery.win.recoveryRate >= 0.9 ? '#f59e0b' : '#ef4444') : (summary.thisMonth.totalRaces > 0 && (3.0 * summary.thisMonth.topPickHitRate) >= 1.0 ? '#10b981' : summary.thisMonth.totalRaces > 0 && (3.0 * summary.thisMonth.topPickHitRate) >= 0.9 ? '#f59e0b' : '#ef4444')}}>{summary.overall.actualRecovery?.win?.totalInvestment > 0 ? (summary.overall.actualRecovery.win.recoveryRate * 100).toFixed(1) + '%' : (summary.thisMonth.totalRaces > 0 ? (3.0 * summary.thisMonth.topPickHitRate * 100).toFixed(1) + '%*' : '-')}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center'}}>{summary.thisMonth.totalRaces > 0 && summary.thisMonth.topPickHitRate >= 0.33 ? '✅' : '❌'}</td>
                  </tr>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>複勝</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約1.5倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>67%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>{summary.thisMonth.totalRaces > 0 ? formatPercent(summary.thisMonth.topPickPlaceRate) : '-'}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: summary.overall.actualRecovery?.place?.totalInvestment > 0 ? (summary.overall.actualRecovery.place.recoveryRate >= 1.0 ? '#10b981' : summary.overall.actualRecovery.place.recoveryRate >= 0.9 ? '#f59e0b' : '#ef4444') : (summary.thisMonth.totalRaces > 0 && (1.5 * summary.thisMonth.topPickPlaceRate) >= 1.0 ? '#10b981' : summary.thisMonth.totalRaces > 0 && (1.5 * summary.thisMonth.topPickPlaceRate) >= 0.9 ? '#f59e0b' : '#ef4444')}}>{summary.overall.actualRecovery?.place?.totalInvestment > 0 ? (summary.overall.actualRecovery.place.recoveryRate * 100).toFixed(1) + '%' : (summary.thisMonth.totalRaces > 0 ? (1.5 * summary.thisMonth.topPickPlaceRate * 100).toFixed(1) + '%*' : '-')}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center'}}>{summary.thisMonth.totalRaces > 0 && summary.thisMonth.topPickPlaceRate >= 0.67 ? '✅' : '❌'}</td>
                  </tr>
                  <tr style={{borderBottom: '1px solid #e2e8f0'}}>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>3連複</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約15-20倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>5-7%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>{summary.thisMonth.totalRaces > 0 ? formatPercent(summary.thisMonth.top3HitRate) : '-'}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: summary.overall.actualRecovery?.trifecta?.totalInvestment > 0 ? (summary.overall.actualRecovery.trifecta.recoveryRate >= 1.0 ? '#10b981' : summary.overall.actualRecovery.trifecta.recoveryRate >= 0.9 ? '#f59e0b' : '#ef4444') : (summary.thisMonth.totalRaces > 0 && (17.5 * summary.thisMonth.top3HitRate) >= 1.0 ? '#10b981' : summary.thisMonth.totalRaces > 0 && (17.5 * summary.thisMonth.top3HitRate) >= 0.9 ? '#f59e0b' : '#ef4444')}}>{summary.overall.actualRecovery?.trifecta?.totalInvestment > 0 ? (summary.overall.actualRecovery.trifecta.recoveryRate * 100).toFixed(1) + '%' : (summary.thisMonth.totalRaces > 0 ? (17.5 * summary.thisMonth.top3HitRate * 100).toFixed(1) + '%*' : '-')}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center'}}>{summary.thisMonth.totalRaces > 0 && summary.thisMonth.top3HitRate >= 0.05 ? '✅' : '❌'}</td>
                  </tr>
                  <tr>
                    <td style={{padding: '0.75rem', fontWeight: '600', color: '#0f172a'}}>3連単</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>約80-100倍</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', color: '#1e293b'}}>1-1.25%以上</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#3b82f6'}}>{summary.thisMonth.totalRaces > 0 ? formatPercent(summary.thisMonth.top3IncludedRate) : '-'}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center', fontWeight: '700', color: summary.overall.actualRecovery?.trio?.totalInvestment > 0 ? (summary.overall.actualRecovery.trio.recoveryRate >= 1.0 ? '#10b981' : summary.overall.actualRecovery.trio.recoveryRate >= 0.9 ? '#f59e0b' : '#ef4444') : (summary.thisMonth.totalRaces > 0 && (90 * summary.thisMonth.top3IncludedRate) >= 1.0 ? '#10b981' : summary.thisMonth.totalRaces > 0 && (90 * summary.thisMonth.top3IncludedRate) >= 0.9 ? '#f59e0b' : '#ef4444')}}>{summary.overall.actualRecovery?.trio?.totalInvestment > 0 ? (summary.overall.actualRecovery.trio.recoveryRate * 100).toFixed(1) + '%' : (summary.thisMonth.totalRaces > 0 ? (90 * summary.thisMonth.top3IncludedRate * 100).toFixed(1) + '%*' : '-')}</td>
                    <td style={{padding: '0.75rem', textAlign: 'center'}}>{summary.thisMonth.totalRaces > 0 && summary.thisMonth.top3IncludedRate >= 0.01 ? '✅' : '❌'}</td>
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
