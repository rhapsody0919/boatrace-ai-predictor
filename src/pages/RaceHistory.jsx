import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Header from '../components/Header'
import Breadcrumb from '../components/Breadcrumb'
import LoadingScreen from '../components/LoadingScreen'
import ModelComparisonTable from '../components/ModelComparisonTable'
import { dataService } from '../services/dataService'
import { MODEL_NAMES, MODEL_KEYS } from '../constants'
import { formatDateObject } from '../utils/formatters'
import './RaceHistory.css'

function RaceHistory() {
  const [groupedDates, setGroupedDates] = useState({})
  const [loading, setLoading] = useState(true)
  const [expandedMonths, setExpandedMonths] = useState({})

  // 月の切り替え
  const toggleMonth = (yearMonth) => {
    setExpandedMonths(prev => ({
      ...prev,
      [yearMonth]: !prev[yearMonth]
    }))
  }

  // 利用可能な日付を取得し、月別にグループ化（サマリーRPCで1回のクエリ）
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true)

        // サマリーRPCで全日付分の統計を1回のクエリで取得
        const summary = await dataService.getRaceHistorySummary(90)
        const dates = (summary.days || []).map(day => {
          const dayModels = day.models || []

          // DBの集計値を既存の modelComparison 形式に変換
          const modelComparison = MODEL_KEYS.map(modelKey => {
            const m = dayModels.find(x => x.modelId === modelKey) || {}
            const finished = m.finishedRaces || 0
            return {
              key: modelKey,
              name: MODEL_NAMES[modelKey],
              races: finished,
              winHitRate: finished > 0 ? (m.winHits || 0) / finished : 0,
              winRecoveryRate: finished > 0 ? ((m.winPayouts || 0) / 100) / finished : 0,
              placeHitRate: finished > 0 ? (m.placeHits || 0) / finished : 0,
              placeRecoveryRate: finished > 0 ? ((m.placePayouts || 0) / 100) / finished : 0,
              trifectaHitRate: finished > 0 ? (m.trifectaHits || 0) / finished : 0,
              trifectaRecoveryRate: finished > 0 ? ((m.trifectaPayouts || 0) / 100) / finished : 0,
              trioHitRate: finished > 0 ? (m.trioHits || 0) / finished : 0,
              trioRecoveryRate: finished > 0 ? ((m.trioPayouts || 0) / 100) / finished : 0
            }
          })

          return {
            date: day.date,
            totalRaces: day.totalRaces || 0,
            finishedRaces: day.finishedRaces || 0,
            modelComparison
          }
        })

        // 月別にグループ化
        const grouped = {}
        dates.forEach(dateInfo => {
          const { yearMonth } = formatDateObject(dateInfo.date)
          if (!grouped[yearMonth]) {
            grouped[yearMonth] = []
          }
          grouped[yearMonth].push(dateInfo)
        })

        // 各月をソート（日付の新しい順）
        Object.keys(grouped).forEach(month => {
          grouped[month].sort((a, b) => b.date.localeCompare(a.date))
        })

        setGroupedDates(grouped)

        // 最新月のみ展開
        const latestMonth = Object.keys(grouped).sort().reverse()[0]
        if (latestMonth) {
          setExpandedMonths({ [latestMonth]: true })
        }

      } catch (error) {
        console.error('日付データの取得エラー:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSummary()
  }, [])

  const breadcrumbItems = [
    { label: 'ホーム', path: '/' },
    { label: '過去の予想', path: '/races' }
  ]

  // 月のサマリーを計算
  const getMonthSummary = (dates) => {
    const totalRaces = dates.reduce((sum, d) => sum + d.finishedRaces, 0)
    // スタンダードモデルの平均的中率を計算
    let totalWinHits = 0
    dates.forEach(d => {
      const standardModel = d.modelComparison?.find(m => m.key === 'standard')
      if (standardModel) {
        totalWinHits += standardModel.winHitRate * standardModel.races
      }
    })
    const avgWinRate = totalRaces > 0 ? ((totalWinHits / totalRaces) * 100).toFixed(1) : '0.0'
    return { totalRaces, avgWinRate, days: dates.length }
  }

  return (
    <>
      <Helmet>
        <title>過去のAI予想データ - BoatAI</title>
        <meta name="description" content="BoatAIの過去のレース予想データと的中実績を確認できます。日別の的中率や回収率をチェックして、AIの精度を検証してください。" />
        <meta property="og:title" content="過去のAI予想データ - BoatAI" />
        <meta property="og:description" content="BoatAIの過去のレース予想データと的中実績を確認できます。" />
        <link rel="canonical" href="https://www.boat-ai.jp/races" />
      </Helmet>

      <Header />

      <div className="race-history-page">
        <Breadcrumb items={breadcrumbItems} />

      <div className="race-history-container">
        <header className="page-header">
          <h1>📅 過去の予想データ</h1>
          <p className="page-description">
            過去のレース予想と的中実績を日付別に確認できます。
          </p>
        </header>

        {/* 月別日付一覧 */}
        <div className="dates-section">
          {loading ? (
            <LoadingScreen
              title="過去の予想データを読み込み中..."
              description="過去90日分のデータを確認しています"
            />
          ) : Object.keys(groupedDates).length === 0 ? (
            <div className="no-data">
              <p>利用可能なデータがありません</p>
            </div>
          ) : (
            <div className="month-groups">
              {Object.keys(groupedDates).sort().reverse().map(yearMonth => {
                const dates = groupedDates[yearMonth]
                const summary = getMonthSummary(dates)
                const isExpanded = expandedMonths[yearMonth]

                return (
                  <div key={yearMonth} className="month-group">
                    <div
                      className="month-header"
                      onClick={() => toggleMonth(yearMonth)}
                    >
                      <div className="month-title">
                        <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                        <h2>📅 {yearMonth}</h2>
                      </div>
                      <div className="month-summary">
                        {summary.days}日分 | {summary.totalRaces}レース | 単勝的中率 {summary.avgWinRate}%
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="dates-list">
                        {dates.map(dateInfo => (
                          <Link
                            key={dateInfo.date}
                            to={`/races/${dateInfo.date}`}
                            className="date-card"
                          >
                            <div className="date-card-header">
                              <h3>{formatDateObject(dateInfo.date).short}</h3>
                              <span className="race-count">
                                {dateInfo.finishedRaces}/{dateInfo.totalRaces} レース完了
                              </span>
                            </div>

                            {/* モデル間パフォーマンス比較表 */}
                            <ModelComparisonTable
                              data={dateInfo.modelComparison}
                              compact={true}
                            />

                            <div className="date-card-footer">
                              <span className="view-detail">詳細を見る →</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  )
}

export default RaceHistory
