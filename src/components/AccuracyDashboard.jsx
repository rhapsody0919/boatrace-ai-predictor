import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import UpdateStatus from './UpdateStatus'
import './AccuracyDashboard.css'

function AccuracyDashboard() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedModel, setSelectedModel] = useState('standard')

  // 競艇場名マッピング
  const stadiumNames = {
    1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
    7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
    13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
    19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
  }

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
        <h2>📊 成績</h2>
        <div className="loading">的中率データを読み込み中...</div>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="accuracy-dashboard">
        <h2>📊 成績</h2>
        <div className="error-message">
          <p>的中率データはまだ利用できません。レース終了後に自動計算されます。</p>
          <button
            className="reload-button"
            onClick={() => window.location.reload()}
          >
            🔄 再読み込み
          </button>
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

  // モデル比較データを取得
  const getModelComparisonData = () => {
    if (!summary.models) return null

    const models = ['standard', 'safeBet', 'upsetFocus']
    const modelNames = {
      standard: 'スタンダード',
      safeBet: '本命狙い',
      upsetFocus: '穴狙い'
    }

    return models.map(modelKey => {
      const model = summary.models[modelKey]
      const thisMonth = model.thisMonth || {}

      return {
        key: modelKey,
        name: modelNames[modelKey],
        races: thisMonth.totalRaces || 0,
        winHitRate: thisMonth.topPickHitRate || 0,
        winRecoveryRate: thisMonth.actualRecovery?.win?.recoveryRate || 0,
        placeHitRate: thisMonth.topPickPlaceRate || 0,
        placeRecoveryRate: thisMonth.actualRecovery?.place?.recoveryRate || 0,
        trifectaHitRate: thisMonth.top3HitRate || 0,
        trifectaRecoveryRate: thisMonth.actualRecovery?.trifecta?.recoveryRate || 0,
        trioHitRate: thisMonth.top3IncludedRate || 0,
        trioRecoveryRate: thisMonth.actualRecovery?.trio?.recoveryRate || 0
      }
    })
  }

  const modelComparison = getModelComparisonData()

  // 最終更新時刻をフォーマット
  const formatLastUpdated = (isoString) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${year}/${month}/${day} ${hours}:${minutes}`
  }

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

  // 競艇場別詳細分析セクション
  const VenueDetailedAnalysis = () => {
    if (!summary.models) return null

    const [detailVenue, setDetailVenue] = useState('1') // デフォルトは桐生
    const [detailModel, setDetailModel] = useState('standard')

    const modelNames = {
      standard: 'スタンダード',
      safeBet: '本命狙い',
      upsetFocus: '穴狙い'
    }

    const venueData = summary.models[detailModel]?.byVenue?.[detailVenue]
    if (!venueData) return null

    return (
      <div className="venue-detailed-analysis">
        <h3>📊 競艇場別詳細分析</h3>
        <p className="section-description">
          特定の競艇場とモデルを選択して詳細な統計を確認できます
        </p>

        {/* 競艇場セレクター */}
        <div className="venue-selector">
          <label htmlFor="detail-venue-select">競艇場:</label>
          <select
            id="detail-venue-select"
            value={detailVenue}
            onChange={(e) => setDetailVenue(e.target.value)}
          >
            {Object.entries(stadiumNames).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* モデル選択タブ */}
        <div className="strategy-model-selector">
          <button
            className={detailModel === 'standard' ? 'active' : ''}
            onClick={() => setDetailModel('standard')}
          >
            スタンダード
          </button>
          <button
            className={detailModel === 'safeBet' ? 'active' : ''}
            onClick={() => setDetailModel('safeBet')}
          >
            本命狙い
          </button>
          <button
            className={detailModel === 'upsetFocus' ? 'active' : ''}
            onClick={() => setDetailModel('upsetFocus')}
          >
            穴狙い
          </button>
        </div>

        {/* 選択された競艇場の統計 */}
        <div className="venue-stats-grid">
          {venueData.thisMonth && venueData.thisMonth.totalRaces > 0 && (
            <StatsTable
              data={venueData.thisMonth}
              title={`今月の成績（${stadiumNames[detailVenue]}）`}
            />
          )}
          {venueData.overall && venueData.overall.totalRaces > 0 && (
            <StatsTable
              data={venueData.overall}
              title={`全期間の成績（${stadiumNames[detailVenue]}）`}
            />
          )}
        </div>

        {venueData.thisMonth?.totalRaces === 0 && venueData.overall?.totalRaces === 0 && (
          <p className="no-data-message" style={{textAlign: 'center', padding: '2rem', color: '#64748b'}}>
            {stadiumNames[detailVenue]}のデータはまだありません
          </p>
        )}
      </div>
    )
  }

  // 競艇場別投資戦略テーブルコンポーネント（上部モデルタブに連動）
  const VenueStrategyTable = () => {
    if (!summary.models) return null

    const modelNames = {
      standard: 'スタンダード',
      safeBet: '本命狙い',
      upsetFocus: '穴狙い'
    }

    const betTypeNames = {
      win: '単勝',
      place: '複勝',
      trifecta: '3連複',
      trio: '3連単'
    }

    // 選択されたモデルの24競艇場データを取得（上部のselectedModelを使用）
    const venueData = Object.keys(stadiumNames).map(venueCode => {
      const venueStats = summary.models[selectedModel]?.byVenue?.[venueCode]
      const thisMonthStats = venueStats?.thisMonth

      return {
        venueCode: parseInt(venueCode),
        venueName: stadiumNames[venueCode],
        win: thisMonthStats?.actualRecovery?.win?.recoveryRate,
        place: thisMonthStats?.actualRecovery?.place?.recoveryRate,
        trifecta: thisMonthStats?.actualRecovery?.trifecta?.recoveryRate,
        trio: thisMonthStats?.actualRecovery?.trio?.recoveryRate,
        totalRaces: thisMonthStats?.totalRaces || 0
      }
    })

    return (
      <div className="venue-strategy-section">
        <h3>🎯 競艇場別投資戦略（今月）</h3>
        <p className="section-description">
          {modelNames[selectedModel]}モデルの各競艇場・各買い方の回収率を表示しています
        </p>

        <div className="table-wrapper">
          <table className="venue-strategy-table">
            <thead>
              <tr>
                <th>競艇場</th>
                <th>単勝</th>
                <th>複勝</th>
                <th>3連複</th>
                <th>3連単</th>
              </tr>
            </thead>
            <tbody>
              {venueData.map(venue => (
                <tr key={venue.venueCode}>
                  <td className="venue-name">{venue.venueName}</td>
                  <td className="recovery-rate" style={{color: venue.win ? getRecoveryColor(venue.win) : '#64748b'}}>
                    {venue.win !== undefined ? formatPercent(venue.win) : '-'}
                  </td>
                  <td className="recovery-rate" style={{color: venue.place ? getRecoveryColor(venue.place) : '#64748b'}}>
                    {venue.place !== undefined ? formatPercent(venue.place) : '-'}
                  </td>
                  <td className="recovery-rate" style={{color: venue.trifecta ? getRecoveryColor(venue.trifecta) : '#64748b'}}>
                    {venue.trifecta !== undefined ? formatPercent(venue.trifecta) : '-'}
                  </td>
                  <td className="recovery-rate" style={{color: venue.trio ? getRecoveryColor(venue.trio) : '#64748b'}}>
                    {venue.trio !== undefined ? formatPercent(venue.trio) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          💡 回収率100%以上（緑色）なら黒字、100%未満なら赤字を意味します
        </p>
      </div>
    )
  }

  // モデル比較表コンポーネント
  const ModelComparisonTable = () => {
    if (!modelComparison) return null

    // Get date range for this month's data
    const getThisMonthDateRange = () => {
      if (!summary.models || !summary.models.standard.dailyHistory) return ''
      const history = summary.models.standard.dailyHistory
      const thisMonthHistory = history.filter(day => {
        const { year, month } = getDateInfo(day.date)
        return year === modelData.thisMonth.year && month === modelData.thisMonth.month
      })
      if (thisMonthHistory.length === 0) return ''
      const startDate = thisMonthHistory[0].date
      const endDate = thisMonthHistory[thisMonthHistory.length - 1].date
      return `${startDate.substring(5)} - ${endDate.substring(5)}`
    }

    const dateRange = getThisMonthDateRange()

    return (
      <div className="model-comparison-section">
        <h3>📊 モデル間パフォーマンス比較（今月{dateRange ? `: ${dateRange}` : ''}）</h3>
        <div className="table-wrapper">
          <table className="model-comparison-table">
            <thead>
              <tr>
                <th>モデル</th>
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
              {modelComparison.map(model => (
                <tr key={model.key} className={model.key === selectedModel ? 'selected-model' : ''}>
                  <td className="model-name">{model.name}</td>
                  <td className="races-cell">{model.races > 0 ? `${model.races}レース` : '-'}</td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.winHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{color: model.races > 0 ? getRecoveryColor(model.winRecoveryRate) : '#64748b'}}>
                    {model.races > 0 ? formatPercent(model.winRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.placeHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{color: model.races > 0 ? getRecoveryColor(model.placeRecoveryRate) : '#64748b'}}>
                    {model.races > 0 ? formatPercent(model.placeRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trifectaHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{color: model.races > 0 ? getRecoveryColor(model.trifectaRecoveryRate) : '#64748b'}}>
                    {model.races > 0 ? formatPercent(model.trifectaRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trioHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{color: model.races > 0 ? getRecoveryColor(model.trioRecoveryRate) : '#64748b'}}>
                    {model.races > 0 ? formatPercent(model.trioRecoveryRate) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // 統計の信頼性警告コンポーネント
  const ReliabilityWarning = ({ races }) => {
    if (races >= 100) return null

    return (
      <div className="reliability-warning">
        <span className="warning-icon">⚠️</span>
        <div className="warning-content">
          <strong>統計の信頼性について</strong>
          <p>
            現在のレース数は{races}レースです。
            統計的に信頼性のある結果を得るには、最低100レース以上のデータが推奨されます。
          </p>
        </div>
      </div>
    )
  }

  // 回収率推移グラフコンポーネント
  const RecoveryTrendChart = () => {
    if (!modelData.dailyHistory || modelData.dailyHistory.length === 0) return null

    // 直近7日分のデータを準備
    const chartData = modelData.dailyHistory.slice(-7).map(day => ({
      date: day.date.substring(5), // MM-DDのみ表示
      単勝: (day.actualRecovery?.win?.recoveryRate || 0) * 100,
      複勝: (day.actualRecovery?.place?.recoveryRate || 0) * 100,
      '3連複': (day.actualRecovery?.trifecta?.recoveryRate || 0) * 100,
      '3連単': (day.actualRecovery?.trio?.recoveryRate || 0) * 100,
    }))

    return (
      <div className="recovery-trend-section">
        <h3>📈 回収率推移（直近7日）</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis label={{ value: '回収率 (%)', angle: -90, position: 'insideLeft' }} />
            <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
            <Legend />
            <Line type="monotone" dataKey="単勝" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="複勝" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="3連複" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="3連単" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
        <div className="chart-note">
          💡 100%を超えると黒字、下回ると赤字を意味します
        </div>
      </div>
    )
  }

  // 本日の日付をフォーマット
  const getTodayDate = () => {
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() + 1
    const day = today.getDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const weekday = weekdays[today.getDay()]
    return `${year}年${month}月${day}日（${weekday}）`
  }

  return (
    <div className="accuracy-dashboard">
      <div className="dashboard-header">
        <h2>📊 成績</h2>
        <p className="last-updated">{getTodayDate()}</p>
      </div>
      <UpdateStatus lastUpdated={summary.lastUpdated} dataType="成績データ" />

      {/* Model selector - only show if models data exists */}
      {summary.models && <ModelSelector />}

      {/* モデル間比較表 */}
      {summary.models && <ModelComparisonTable />}

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
          {/* 統計の信頼性警告 */}
          <ReliabilityWarning races={modelData.thisMonth.totalRaces || 0} />

          {/* 直近のパフォーマンス */}
          {modelData.dailyHistory && modelData.dailyHistory.length > 0 && (
            <div className="daily-history">
              <h3>直近7日間のパフォーマンス{(() => {
                const last7Days = modelData.dailyHistory.slice(-7)
                if (last7Days.length > 0) {
                  const startDate = last7Days[0].date.substring(5)
                  const endDate = last7Days[last7Days.length - 1].date.substring(5)
                  return ` (${startDate} - ${endDate})`
                }
                return ''
              })()}</h3>
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

          {/* 回収率推移グラフ */}
          <RecoveryTrendChart />

          {/* 競艇場別投資戦略テーブル */}
          <VenueStrategyTable />

          {/* 競艇場別詳細分析 */}
          <VenueDetailedAnalysis />

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
