import { useState, useEffect } from 'react'
import './AccuracyDashboard.css'

function AccuracyDashboard() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedModel, setSelectedModel] = useState('standard')

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

  // Get model-specific data with backward compatibility
  const getModelData = () => {
    // If summary has models structure, use it
    if (summary.models && summary.models[selectedModel]) {
      return summary.models[selectedModel]
    }
    // Backward compatibility: if no models structure, use old structure (assume it's standard model)
    return {
      overall: summary.overall,
      yesterday: summary.yesterday,
      thisMonth: summary.thisMonth,
      lastMonth: summary.lastMonth,
      dailyHistory: summary.dailyHistory
    }
  }

  const modelData = getModelData()
  const hasData = modelData.overall.totalRaces > 0

  // 今月の最も回収率が高いモデルを取得
  const getBestModelThisMonth = () => {
    if (!summary.models) return null

    const models = ['standard', 'safeBet', 'upsetFocus']
    const modelNames = {
      standard: 'スタンダード',
      safeBet: '本命狙い',
      upsetFocus: '穴狙い'
    }

    let bestModel = null
    let bestRate = 0

    for (const modelKey of models) {
      const model = summary.models[modelKey]
      if (model.thisMonth && model.thisMonth.totalRaces > 0) {
        const trioRate = model.thisMonth.actualRecovery?.trio?.recoveryRate || 0
        if (trioRate > bestRate) {
          bestRate = trioRate
          bestModel = {
            key: modelKey,
            name: modelNames[modelKey],
            rate: trioRate,
            hitRate: model.thisMonth.top3IncludedRate,
            races: model.thisMonth.totalRaces
          }
        }
      }
    }

    return bestModel
  }

  const bestModel = getBestModelThisMonth()

  // 回収率の色を取得
  const getRecoveryColor = (rate) => {
    if (rate >= 1.0) return '#10b981'
    if (rate >= 0.9) return '#f59e0b'
    return '#ef4444'
  }

  // 日付から年月日を取得するヘルパー関数
  const getDateInfo = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    return { year, month, day }
  }

  // 今月で3連単の回収率が最も高かった日を取得
  const bestTrioDay = (() => {
    if (!modelData.dailyHistory || modelData.dailyHistory.length === 0) return null

    const thisMonthDays = modelData.dailyHistory.filter(day => {
      const { year, month } = getDateInfo(day.date)
      return year === modelData.thisMonth.year && month === modelData.thisMonth.month
    })

    if (thisMonthDays.length === 0) return null

    return thisMonthDays.reduce((best, current) => {
      const currentRate = current.actualRecovery?.trio?.recoveryRate || 0
      const bestRate = best.actualRecovery?.trio?.recoveryRate || 0
      return currentRate > bestRate ? current : best
    })
  })()

  // 統計テーブルコンポーネント
  const StatsTable = ({ data, title }) => (
    <div className="stats-table-container">
      <h3>{title}</h3>
      <p className="stats-meta">レース数: {data.totalRaces}レース</p>
      <div className="table-wrapper">
        <table className="stats-table">
          <thead>
            <tr>
              <th>券種</th>
              <th>的中率</th>
              <th>回収率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="bet-type">単勝</td>
              <td className="hit-rate">{formatPercent(data.topPickHitRate)}</td>
              <td className="recovery-rate" style={{color: getRecoveryColor(data.actualRecovery?.win?.recoveryRate || 0)}}>
                {data.actualRecovery?.win ? formatPercent(data.actualRecovery.win.recoveryRate) : '-'}
              </td>
            </tr>
            <tr>
              <td className="bet-type">複勝</td>
              <td className="hit-rate">{formatPercent(data.topPickPlaceRate)}</td>
              <td className="recovery-rate" style={{color: getRecoveryColor(data.actualRecovery?.place?.recoveryRate || 0)}}>
                {data.actualRecovery?.place ? formatPercent(data.actualRecovery.place.recoveryRate) : '-'}
              </td>
            </tr>
            <tr>
              <td className="bet-type">3連複</td>
              <td className="hit-rate">{formatPercent(data.top3HitRate)}</td>
              <td className="recovery-rate" style={{color: getRecoveryColor(data.actualRecovery?.trifecta?.recoveryRate || 0)}}>
                {data.actualRecovery?.trifecta ? formatPercent(data.actualRecovery.trifecta.recoveryRate) : '-'}
              </td>
            </tr>
            <tr>
              <td className="bet-type">3連単</td>
              <td className="hit-rate">{formatPercent(data.top3IncludedRate)}</td>
              <td className="recovery-rate" style={{color: getRecoveryColor(data.actualRecovery?.trio?.recoveryRate || 0)}}>
                {data.actualRecovery?.trio ? formatPercent(data.actualRecovery.trio.recoveryRate) : '-'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )

  // Model selector component
  const ModelSelector = () => (
    <div className="model-selector">
      <button
        className={selectedModel === 'standard' ? 'active' : ''}
        onClick={() => setSelectedModel('standard')}
      >
        スタンダード
      </button>
      <button
        className={selectedModel === 'safeBet' ? 'active' : ''}
        onClick={() => setSelectedModel('safeBet')}
      >
        本命狙い
      </button>
      <button
        className={selectedModel === 'upsetFocus' ? 'active' : ''}
        onClick={() => setSelectedModel('upsetFocus')}
      >
        穴狙い
      </button>
    </div>
  )

  return (
    <div className="accuracy-dashboard">
      <h2>📊 AI予想的中率</h2>

      {/* Model selector - only show if models data exists */}
      {summary.models && <ModelSelector />}

      {!hasData ? (
        <div className="no-data-message">
          <p className="data-collection-status">
            {selectedModel === 'standard'
              ? 'まだレース結果がありません。レース終了後にご確認ください！'
              : `${selectedModel === 'safeBet' ? '本命狙い' : '穴狙い'}モデルのデータを収集中です。\n今日のレース終了後から統計データが蓄積されます。`
            }
          </p>
          {selectedModel !== 'standard' && (
            <p className="model-info">
              💡 過去のデータは全て「スタンダード」モデルとして記録されています。<br/>
              3モデル別の統計は今日のレースから開始されます。
            </p>
          )}
        </div>
      ) : (
        <>
          {/* 今月のベストモデル */}
          {bestModel && (
            <div className="best-model-section">
              <h3>🏆 今月のベストパフォーマンスモデル</h3>
              <div className="best-model-card">
                <div className="model-badge">{bestModel.name}</div>
                <div className="model-stats">
                  <div className="model-stat-item highlight">
                    <span className="stat-label">3連単 回収率</span>
                    <span className="stat-value large" style={{color: getRecoveryColor(bestModel.rate)}}>
                      {formatPercent(bestModel.rate)}
                    </span>
                  </div>
                  <div className="model-stat-item">
                    <span className="stat-label">3連単 的中率</span>
                    <span className="stat-value">{formatPercent(bestModel.hitRate)}</span>
                  </div>
                  <div className="model-stat-item">
                    <span className="stat-label">レース数</span>
                    <span className="stat-value">{bestModel.races}レース</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 今月のベストパフォーマンス（日別） */}
          {bestTrioDay && bestTrioDay.actualRecovery?.trio?.recoveryRate > 0 && (
            <div className="best-performance">
              <h3>🏆 今月のベストパフォーマンス</h3>
              <div className="best-performance-content">
                <div className="best-date">{bestTrioDay.date}</div>
                <div className="best-stats">
                  <div className="best-stat-item highlight">
                    <span className="stat-label">3連単 回収率</span>
                    <span className="stat-value" style={{color: getRecoveryColor(bestTrioDay.actualRecovery.trio.recoveryRate)}}>
                      {formatPercent(bestTrioDay.actualRecovery.trio.recoveryRate)}
                    </span>
                  </div>
                  <div className="best-stat-item">
                    <span className="stat-label">レース数</span>
                    <span className="stat-value">{bestTrioDay.totalRaces}レース</span>
                  </div>
                  <div className="best-stat-item">
                    <span className="stat-label">3連単 的中率</span>
                    <span className="stat-value">{formatPercent(bestTrioDay.top3IncludedRate)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 今月の実績 */}
          {modelData.thisMonth.totalRaces > 0 && (
            <div className="stat-section this-month-section">
              <StatsTable
                data={modelData.thisMonth}
                title={`今月 (${modelData.thisMonth.year}年${modelData.thisMonth.month}月)`}
              />
            </div>
          )}

          {/* 直近のパフォーマンス */}
          {modelData.dailyHistory && modelData.dailyHistory.length > 0 && (
            <div className="daily-history">
              <h3>直近のパフォーマンス</h3>
              <div className="table-wrapper">
                <table className="daily-history-table">
                  <thead>
                    <tr>
                      <th>日付</th>
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
                    {modelData.dailyHistory.slice(-7).reverse().map((day) => (
                      <tr key={day.date}>
                        <td className="date-cell">{day.date}</td>
                        <td className="races-cell">{day.totalRaces}</td>
                        <td className="hit-rate">{formatPercent(day.topPickHitRate)}</td>
                        <td className="recovery-rate" style={{color: getRecoveryColor(day.actualRecovery?.win?.recoveryRate || 0)}}>
                          {day.actualRecovery?.win ? formatPercent(day.actualRecovery.win.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.topPickPlaceRate)}</td>
                        <td className="recovery-rate" style={{color: getRecoveryColor(day.actualRecovery?.place?.recoveryRate || 0)}}>
                          {day.actualRecovery?.place ? formatPercent(day.actualRecovery.place.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.top3HitRate)}</td>
                        <td className="recovery-rate" style={{color: getRecoveryColor(day.actualRecovery?.trifecta?.recoveryRate || 0)}}>
                          {day.actualRecovery?.trifecta ? formatPercent(day.actualRecovery.trifecta.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.top3IncludedRate)}</td>
                        <td className="recovery-rate" style={{color: getRecoveryColor(day.actualRecovery?.trio?.recoveryRate || 0)}}>
                          {day.actualRecovery?.trio ? formatPercent(day.actualRecovery.trio.recoveryRate) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 的中率と回収率についての説明 */}
          <div className="accuracy-info">
            <h4>💡 的中率と回収率について</h4>
            <div className="info-section">
              <h5>📊 的中率の見方</h5>
              <ul>
                <li><strong>単勝:</strong> AI予想の本命（1位予想）が1着になった割合</li>
                <li><strong>複勝:</strong> AI予想の本命が2着以内に入った割合</li>
                <li><strong>3連複:</strong> AI予想のトップ3が実際の1-2-3着を全て含んでいた割合（順序不問）</li>
                <li><strong>3連単:</strong> AI予想のトップ3が実際の1-2-3着と順序も完全一致した割合</li>
              </ul>
            </div>
            <div className="info-section">
              <h5>💰 回収率の見方</h5>
              <p>
                回収率は、実際の配当データに基づいて計算されています。
                競艇の控除率は約25%のため、完全ランダムに購入すると理論上の回収率は約75%です。
                回収率100%超えを目指すには、的中率だけでなく、高配当を狙う戦略も重要です。
              </p>
            </div>
            <div className="info-section">
              <p><strong>データ更新:</strong> レース終了後、自動的に的中率と回収率が計算されます</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AccuracyDashboard
