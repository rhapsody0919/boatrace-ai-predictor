import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import UpdateStatus from './UpdateStatus'
import { dataService } from '../services/dataService'
import { STADIUM_NAMES, MODEL_NAMES, MODEL_KEYS } from '../constants'
import { formatPercent, formatLastUpdated } from '../utils/formatters'
import { getRecoveryColor } from '../utils/colors'
import { parseDateInfo } from '../utils/dateUtils'
import {
  StatsTable,
  ModelSelector,
  ReliabilityWarning,
  RecoveryTrendChart,
  VenueStrategyTable,
  VenueDetailedAnalysis,
  VolatilityAccuracySection
} from './accuracy'
import LoadingScreen from './LoadingScreen'
import './AccuracyDashboard.css'

function AccuracyDashboard({ onRefresh, isRefreshing }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedModel, setSelectedModel] = useState('standard')

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true)
        const data = await dataService.getAccuracy()
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
        <LoadingScreen
          title="的中率データを読み込み中..."
          description="成績データを集計しています"
        />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="accuracy-dashboard">
        <h2>📊 成績</h2>
        <div className="error-message">
          <p>的中率データはまだ利用できません。レース終了後に自動計算されます。</p>
          <button className="reload-button" onClick={() => window.location.reload()}>
            🔄 再読み込み
          </button>
        </div>
      </div>
    )
  }

  // Get model-specific data with backward compatibility
  const getModelData = () => {
    if (summary.models && summary.models[selectedModel]) {
      return summary.models[selectedModel]
    }
    return {
      overall: summary.overall,
      yesterday: summary.yesterday,
      thisMonth: summary.thisMonth,
      lastMonth: summary.lastMonth,
      dailyHistory: summary.dailyHistory
    }
  }

  const modelData = getModelData()
  const hasData = modelData.overall?.totalRaces > 0

  // モデル比較データを取得
  const getModelComparisonData = () => {
    if (!summary.models) return null

    return MODEL_KEYS.map(modelKey => {
      const model = summary.models[modelKey]
      const thisMonth = model?.thisMonth || {}

      return {
        key: modelKey,
        name: MODEL_NAMES[modelKey],
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

  // モデル比較表コンポーネント（内部）
  const ModelComparisonTable = () => {
    if (!modelComparison) return null

    const getThisMonthDateRange = () => {
      if (!modelData.thisMonth) return ''
      const { year, month } = modelData.thisMonth
      // 今日の日付を取得（JST）
      const now = new Date()
      const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
      const todayYear = jstNow.getUTCFullYear()
      const todayMonth = jstNow.getUTCMonth() + 1
      const todayDay = jstNow.getUTCDate()

      // 今月の場合は今日まで、過去の月の場合は月末まで
      const endDay = (year === todayYear && month === todayMonth)
        ? todayDay
        : new Date(year, month, 0).getDate()

      const monthStr = String(month).padStart(2, '0')
      return `${monthStr}-01 - ${monthStr}-${String(endDay).padStart(2, '0')}`
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
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.winRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.winRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.placeHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.placeRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.placeRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trifectaHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.trifectaRecoveryRate) : '#64748b' }}>
                    {model.races > 0 ? formatPercent(model.trifectaRecoveryRate) : '-'}
                  </td>
                  <td className="hit-rate">{model.races > 0 ? formatPercent(model.trioHitRate) : '-'}</td>
                  <td className="recovery-rate" style={{ color: model.races > 0 ? getRecoveryColor(model.trioRecoveryRate) : '#64748b' }}>
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

  return (
    <>
      <Helmet>
        <title>成績ダッシュボード | BoatAI</title>
        <meta name="description" content="BoatAIのAI予測成績ダッシュボード。単勝・複勝・3連複・3連単の的中率と回収率をモデル別・会場別に公開中。" />
        <link rel="canonical" href="https://www.boat-ai.jp/accuracy" />
      </Helmet>
      <div className="accuracy-dashboard">
        <div className="dashboard-header">
          <h2>📊 成績</h2>
          <p className="last-updated">{getTodayDate()}</p>
        </div>
        <UpdateStatus lastUpdated={summary.lastUpdated} dataType="成績データ" onRefresh={onRefresh} isRefreshing={isRefreshing} />

      {summary.models && (
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />
      )}

      {summary.models && <ModelComparisonTable />}

      {summary.volatilityStats && (
        <VolatilityAccuracySection stats={summary.volatilityStats} />
      )}

      {summary.models && (
        <div className="history-link-container">
          <Link to="/accuracy/history" className="history-link">
            📅 過去の月別成績を見る
          </Link>
        </div>
      )}

      {!hasData ? (
        <div className="no-data-message">
          <p className="data-collection-status">
            {selectedModel === 'standard'
              ? 'まだレース結果がありません。レース終了後にご確認ください！'
              : `${MODEL_NAMES[selectedModel]}モデルのデータを収集中です。\n今日のレース終了後から統計データが蓄積されます。`
            }
          </p>
          {selectedModel !== 'standard' && (
            <p className="model-info">
              💡 過去のデータは全て「スタンダード」モデルとして記録されています。<br />
              3モデル別の統計は今日のレースから開始されます。
            </p>
          )}
        </div>
      ) : (
        <>
          <ReliabilityWarning races={modelData.thisMonth?.totalRaces || 0} />

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
                        <td className="recovery-rate" style={{ color: getRecoveryColor(day.actualRecovery?.win?.recoveryRate || 0) }}>
                          {day.actualRecovery?.win ? formatPercent(day.actualRecovery.win.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.topPickPlaceRate)}</td>
                        <td className="recovery-rate" style={{ color: getRecoveryColor(day.actualRecovery?.place?.recoveryRate || 0) }}>
                          {day.actualRecovery?.place ? formatPercent(day.actualRecovery.place.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.top3HitRate)}</td>
                        <td className="recovery-rate" style={{ color: getRecoveryColor(day.actualRecovery?.trifecta?.recoveryRate || 0) }}>
                          {day.actualRecovery?.trifecta ? formatPercent(day.actualRecovery.trifecta.recoveryRate) : '-'}
                        </td>
                        <td className="hit-rate">{formatPercent(day.top3IncludedRate)}</td>
                        <td className="recovery-rate" style={{ color: getRecoveryColor(day.actualRecovery?.trio?.recoveryRate || 0) }}>
                          {day.actualRecovery?.trio ? formatPercent(day.actualRecovery.trio.recoveryRate) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <RecoveryTrendChart dailyHistory={modelData.dailyHistory} />
          <VenueStrategyTable models={summary.models} selectedModel={selectedModel} />
          <VenueDetailedAnalysis models={summary.models} />

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
                ボートレースの控除率は約25%のため、完全ランダムに購入すると理論上の回収率は約75%です。
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
    </>
  )
}

export default AccuracyDashboard
