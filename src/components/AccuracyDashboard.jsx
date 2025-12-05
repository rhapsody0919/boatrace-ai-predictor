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
                  <div className="stat-label">本命的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.yesterday.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">トップ3的中率:</span>
                    <span className="detail-value">{formatPercent(summary.yesterday.top3HitRate)}</span>
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
                  <div className="stat-label">本命的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.thisMonth.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">トップ3的中率:</span>
                    <span className="detail-value">{formatPercent(summary.thisMonth.top3HitRate)}</span>
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
                  <div className="stat-label">本命的中率</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">レース数:</span>
                    <span className="detail-value">{summary.lastMonth.totalRaces}レース</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">トップ3的中率:</span>
                    <span className="detail-value">{formatPercent(summary.lastMonth.top3HitRate)}</span>
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
                      <span className="history-races">{day.totalRaces}レース</span>
                      <span className="history-rate">{formatPercent(day.topPickHitRate)}</span>
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
              <li><strong>本命的中率:</strong> AI予想の本命（1位予想）が実際に1着になった割合</li>
              <li><strong>トップ3的中率:</strong> AI予想のトップ3が実際の1-2-3着を全て含んでいた割合（3連複）</li>
              <li><strong>データ更新:</strong> レース終了後、自動的に的中率が計算されます</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

export default AccuracyDashboard
