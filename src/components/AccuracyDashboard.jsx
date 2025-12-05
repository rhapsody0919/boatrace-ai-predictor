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
        <h2>AI Prediction Accuracy</h2>
        <div className="loading">Loading accuracy data...</div>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="accuracy-dashboard">
        <h2>AI Prediction Accuracy</h2>
        <div className="error-message">
          Accuracy data not yet available. Results will be calculated after races finish.
        </div>
      </div>
    )
  }

  const formatPercent = (rate) => (rate * 100).toFixed(1) + '%'
  const hasData = summary.overall.totalRaces > 0

  return (
    <div className="accuracy-dashboard">
      <h2>AI Prediction Accuracy</h2>

      {!hasData ? (
        <div className="no-data-message">
          No completed races yet. Check back after races finish!
        </div>
      ) : (
        <>
          {/* Overall Stats */}
          <div className="stats-grid">
            <div className="stat-card overall">
              <h3>Overall Performance</h3>
              <div className="stat-main">
                <div className="stat-value">{formatPercent(summary.overall.topPickHitRate)}</div>
                <div className="stat-label">Top Pick Accuracy</div>
              </div>
              <div className="stat-details">
                <div className="detail-item">
                  <span className="detail-label">Total Races:</span>
                  <span className="detail-value">{summary.overall.totalRaces}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Hits:</span>
                  <span className="detail-value">{summary.overall.topPickHits}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Top 3 Accuracy:</span>
                  <span className="detail-value">{formatPercent(summary.overall.top3HitRate)}</span>
                </div>
              </div>
            </div>

            {/* Yesterday */}
            {summary.yesterday.totalRaces > 0 && (
              <div className="stat-card yesterday">
                <h3>Yesterday ({summary.yesterday.date})</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.yesterday.topPickHitRate)}</div>
                  <div className="stat-label">Top Pick Accuracy</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">Races:</span>
                    <span className="detail-value">{summary.yesterday.totalRaces}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Top 3 Accuracy:</span>
                    <span className="detail-value">{formatPercent(summary.yesterday.top3HitRate)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* This Month */}
            {summary.thisMonth.totalRaces > 0 && (
              <div className="stat-card this-month">
                <h3>This Month ({summary.thisMonth.year}/{summary.thisMonth.month})</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.thisMonth.topPickHitRate)}</div>
                  <div className="stat-label">Top Pick Accuracy</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">Races:</span>
                    <span className="detail-value">{summary.thisMonth.totalRaces}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Top 3 Accuracy:</span>
                    <span className="detail-value">{formatPercent(summary.thisMonth.top3HitRate)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Last Month */}
            {summary.lastMonth.totalRaces > 0 && (
              <div className="stat-card last-month">
                <h3>Last Month ({summary.lastMonth.year}/{summary.lastMonth.month})</h3>
                <div className="stat-main">
                  <div className="stat-value">{formatPercent(summary.lastMonth.topPickHitRate)}</div>
                  <div className="stat-label">Top Pick Accuracy</div>
                </div>
                <div className="stat-details">
                  <div className="detail-item">
                    <span className="detail-label">Races:</span>
                    <span className="detail-value">{summary.lastMonth.totalRaces}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Daily History */}
          {summary.dailyHistory && summary.dailyHistory.length > 0 && (
            <div className="daily-history">
              <h3>Recent Performance</h3>
              <div className="history-list">
                {summary.dailyHistory.slice(-7).reverse().map((day) => (
                  <div key={day.date} className="history-item">
                    <div className="history-date">{day.date}</div>
                    <div className="history-stats">
                      <span className="history-races">{day.totalRaces} races</span>
                      <span className="history-rate">{formatPercent(day.topPickHitRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="accuracy-info">
            <h4>About Accuracy Metrics</h4>
            <ul>
              <li><strong>Top Pick Accuracy:</strong> Percentage of races where our #1 prediction finished 1st</li>
              <li><strong>Top 3 Accuracy:</strong> Percentage of races where our top 3 predictions included all podium finishers</li>
              <li><strong>Data Updates:</strong> Accuracy is calculated automatically after races finish</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

export default AccuracyDashboard
