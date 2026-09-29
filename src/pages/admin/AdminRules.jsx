/**
 * AdminRules - 管理者向けルール成績ダッシュボード
 * URL: /admin/rules (隠しURL)
 */

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  getTodaysMatchingRaces,
  getRulePerformanceByVenue,
  getAvailableVenues,
  getBetTypeName,
  getReliabilityName,
  getVenueName
} from '../../services/ruleMatchService'
import { getRuleApplicationHistory } from '../../services/adminRuleService'
import { fetchRulePerformance } from '../../services/adminRulePerformance'
import './AdminRules.css'

// タブ定義
const TABS = [
  { id: 'overview', label: '概要' },
  { id: 'venue', label: '会場別' },
  { id: 'today', label: '本日' },
  { id: 'history', label: '履歴' }
]

// ソートキー
const SORT_KEYS = [
  { key: 'recovery', label: '回収率' },
  { key: 'hitRate', label: '的中率' },
  { key: 'samples', label: 'サンプル数' },
  { key: 'ruleId', label: 'ルールID' }
]

function AdminRules() {
  const [activeTab, setActiveTab] = useState('overview')
  const [allRules, setAllRules] = useState([])
  const [overallPerformance, setOverallPerformance] = useState(null)
  const [todaysRaces, setTodaysRaces] = useState([])
  const [weeklyData, setWeeklyData] = useState([])
  const [historyData, setHistoryData] = useState([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [selectedVenue, setSelectedVenue] = useState('all')
  const [venuePerformance, setVenuePerformance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ソート状態
  const [sortKey, setSortKey] = useState('recovery')
  const [sortDesc, setSortDesc] = useState(true)

  // 今日の日付
  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // 前日の日付
  const yesterday = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // 履歴フィルタ（デフォルトは前日）
  const [historyPage, setHistoryPage] = useState(0)
  const [historyStartDate, setHistoryStartDate] = useState(yesterday)
  const [historyEndDate, setHistoryEndDate] = useState(yesterday)
  const HISTORY_PAGE_SIZE = 300

  // 利用可能な会場リスト
  const venues = useMemo(() => getAvailableVenues(), [])

  // 初期データ読み込み
  useEffect(() => {
    loadInitialData()
  }, [])

  // 会場変更時のデータ読み込み
  useEffect(() => {
    if (activeTab === 'venue' && selectedVenue !== 'all') {
      loadVenuePerformance(selectedVenue)
    }
  }, [selectedVenue, activeTab])

  // 履歴タブ切り替え時のデータ読み込み
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistoryData()
    }
  }, [activeTab, historyPage, historyStartDate, historyEndDate])

  async function loadInitialData() {
    setLoading(true)
    setError(null)
    try {
      // 運用成績（全体・ルール別・週別）は /api/admin/rules/performance の1回の取得にまとめた（BOA-567）
      const [performance, todaysData] = await Promise.all([
        fetchRulePerformance(),
        getTodaysMatchingRaces(today)
      ])

      setAllRules(performance.rules)
      setOverallPerformance(performance.overall)
      setTodaysRaces(todaysData)
      setWeeklyData(performance.weekly)
    } catch (err) {
      console.error('データ読み込みエラー:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadVenuePerformance(venueCode) {
    try {
      const data = await getRulePerformanceByVenue(venueCode)
      setVenuePerformance(data)
    } catch (err) {
      console.error('会場別データ読み込みエラー:', err)
    }
  }

  async function loadHistoryData() {
    try {
      const result = await getRuleApplicationHistory(
        historyStartDate || '2026-01-16',
        historyEndDate || today,
        HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE
      )
      setHistoryData(result.data)
      setHistoryTotal(result.total)
    } catch (err) {
      console.error('履歴データ読み込みエラー:', err)
    }
  }

  // ソート済みルール一覧
  const sortedRules = useMemo(() => {
    const sorted = [...allRules]
    sorted.sort((a, b) => {
      let aVal = a[sortKey]
      let bVal = b[sortKey]
      if (sortKey === 'ruleId') {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal)
      }
      return sortDesc ? bVal - aVal : aVal - bVal
    })
    return sorted
  }, [allRules, sortKey, sortDesc])

  // ソートハンドラ
  function handleSort(key) {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  if (loading) {
    return (
      <div className="admin-rules-page">
        <div className="admin-header">
          <h1>ルール成績ダッシュボード</h1>
          <p className="admin-badge">管理者用</p>
        </div>
        <div className="loading-state">
          <div className="spinner" />
          <p>データを読み込み中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="admin-rules-page">
        <div className="admin-header">
          <h1>ルール成績ダッシュボード</h1>
          <p className="admin-badge">管理者用</p>
        </div>
        <div className="error-state">
          <p>エラーが発生しました: {error}</p>
          <button onClick={loadInitialData}>再読み込み</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-rules-page">
      {/* ヘッダー */}
      <div className="admin-header">
        <Link to="/" className="back-link">← トップへ戻る</Link>
        <h1>ルール成績ダッシュボード</h1>
        <p className="admin-badge">管理者用</p>
        {overallPerformance && (
          <p className="operation-period">
            運用期間: {overallPerformance.startDate} 〜 現在
          </p>
        )}
      </div>

      {/* 累積成績サマリー */}
      {overallPerformance && (
        <div className="overall-summary-card">
          <div className="summary-main">
            <span className="summary-label">累積成績:</span>
            <span className="summary-value">
              投資 {overallPerformance.totalInvestment.toLocaleString()}円
            </span>
            <span className="summary-arrow">→</span>
            <span className="summary-value">
              回収 {overallPerformance.totalPayout.toLocaleString()}円
            </span>
            <span className={`recovery-badge ${overallPerformance.recovery >= 100 ? 'positive' : 'negative'}`}>
              回収率 {overallPerformance.recovery}%
            </span>
          </div>
          <div className="summary-detail">
            レース数: {overallPerformance.samples} / 的中数: {overallPerformance.hits} ({overallPerformance.hitRate}%)
          </div>
        </div>
      )}

      {/* タブナビゲーション */}
      <div className="tab-navigation">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div className="tab-content">
        {activeTab === 'overview' && (
          <OverviewTab
            rules={sortedRules}
            sortKey={sortKey}
            sortDesc={sortDesc}
            onSort={handleSort}
            weeklyData={weeklyData}
          />
        )}
        {activeTab === 'venue' && (
          <VenueTab
            venues={venues}
            selectedVenue={selectedVenue}
            onVenueChange={setSelectedVenue}
            venuePerformance={venuePerformance}
            allRules={allRules}
          />
        )}
        {activeTab === 'today' && (
          <TodayTab races={todaysRaces} />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            historyData={historyData}
            historyTotal={historyTotal}
            historyPage={historyPage}
            pageSize={HISTORY_PAGE_SIZE}
            onPageChange={setHistoryPage}
            startDate={historyStartDate}
            endDate={historyEndDate}
            onStartDateChange={setHistoryStartDate}
            onEndDateChange={setHistoryEndDate}
          />
        )}
      </div>
    </div>
  )
}

// 概要タブ
function OverviewTab({ rules, sortKey, sortDesc, onSort, weeklyData }) {
  return (
    <div className="overview-tab">
      {/* 週別推移グラフ */}
      {weeklyData && weeklyData.length > 0 && (
        <div className="weekly-chart-section">
          <h3>週別累積回収率推移</h3>
          <div className="weekly-chart">
            {weeklyData.map((week, idx) => {
              // 回収率100%を基準に高さを計算（80px基準、最小20px、最大120px）
              const barHeight = Math.min(Math.max((week.cumulativeRecovery / 100) * 80, 20), 120)
              return (
                <div key={idx} className="week-bar-container">
                  <div
                    className={`week-bar ${week.cumulativeRecovery >= 100 ? 'positive' : 'negative'}`}
                    style={{ height: `${barHeight}px` }}
                  >
                    <span className="bar-value">{week.cumulativeRecovery}%</span>
                  </div>
                  <span className="week-label">{week.weekLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ルール一覧テーブル */}
      <div className="rules-table-section">
        <h3>全ルール成績一覧 ({rules.length}件)</h3>
        <div className="table-wrapper">
          <table className="rules-table">
            <thead>
              <tr>
                <th
                  className={`sortable ${sortKey === 'ruleId' ? 'sorted' : ''}`}
                  onClick={() => onSort('ruleId')}
                >
                  ルールID {sortKey === 'ruleId' && (sortDesc ? '▼' : '▲')}
                </th>
                <th>会場</th>
                <th>条件</th>
                <th>種別</th>
                <th
                  className={`sortable ${sortKey === 'samples' ? 'sorted' : ''}`}
                  onClick={() => onSort('samples')}
                >
                  サンプル数 {sortKey === 'samples' && (sortDesc ? '▼' : '▲')}
                </th>
                <th>的中数</th>
                <th
                  className={`sortable ${sortKey === 'hitRate' ? 'sorted' : ''}`}
                  onClick={() => onSort('hitRate')}
                >
                  的中率 {sortKey === 'hitRate' && (sortDesc ? '▼' : '▲')}
                </th>
                <th
                  className={`sortable ${sortKey === 'recovery' ? 'sorted' : ''}`}
                  onClick={() => onSort('recovery')}
                >
                  回収率 {sortKey === 'recovery' && (sortDesc ? '▼' : '▲')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.ruleId}>
                  <td className="rule-id">{rule.ruleId}</td>
                  <td>{rule.venueName}</td>
                  <td className="rule-desc">{rule.description}</td>
                  <td>
                    <span className={`bet-type-badge ${rule.betType}`}>
                      {getBetTypeName(rule.betType)}
                    </span>
                  </td>
                  <td className="num-cell">{rule.samples}</td>
                  <td className="num-cell">{rule.hits}</td>
                  <td className="num-cell">{rule.hitRate}%</td>
                  <td className={`num-cell recovery ${rule.recovery >= 100 ? 'positive' : 'negative'}`}>
                    {rule.recovery}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// 会場別タブ
function VenueTab({ venues, selectedVenue, onVenueChange, venuePerformance, allRules }) {
  // 会場別に集計したルール
  const venueRules = useMemo(() => {
    if (selectedVenue === 'all') return allRules
    return allRules.filter(r => r.venueCode === selectedVenue)
  }, [allRules, selectedVenue])

  return (
    <div className="venue-tab">
      <div className="venue-selector">
        <label>会場を選択:</label>
        <select value={selectedVenue} onChange={e => onVenueChange(e.target.value)}>
          <option value="all">全会場</option>
          {venues.map(v => (
            <option key={v.code} value={v.code}>{v.name}</option>
          ))}
        </select>
      </div>

      {selectedVenue !== 'all' && venuePerformance && (
        <div className="venue-summary">
          <h3>{getVenueName(selectedVenue)} の運用成績</h3>
          <div className="venue-stats">
            <div className="stat-item">
              <span className="stat-label">レース数</span>
              <span className="stat-value">{venuePerformance.total.samples}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">的中数</span>
              <span className="stat-value">{venuePerformance.total.hits}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">的中率</span>
              <span className="stat-value">{venuePerformance.total.hitRate}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">回収率</span>
              <span className={`stat-value recovery ${venuePerformance.total.recovery >= 100 ? 'positive' : 'negative'}`}>
                {venuePerformance.total.recovery}%
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="rules-table-section">
        <h3>
          {selectedVenue === 'all' ? '全会場' : getVenueName(selectedVenue)}のルール一覧
          ({venueRules.length}件)
        </h3>
        <div className="table-wrapper">
          <table className="rules-table">
            <thead>
              <tr>
                <th>ルールID</th>
                {selectedVenue === 'all' && <th>会場</th>}
                <th>条件</th>
                <th>種別</th>
                <th>サンプル数</th>
                <th>的中数</th>
                <th>的中率</th>
                <th>回収率</th>
              </tr>
            </thead>
            <tbody>
              {venueRules.map(rule => (
                <tr key={rule.ruleId}>
                  <td className="rule-id">{rule.ruleId}</td>
                  {selectedVenue === 'all' && <td>{rule.venueName}</td>}
                  <td className="rule-desc">{rule.description}</td>
                  <td>
                    <span className={`bet-type-badge ${rule.betType}`}>
                      {getBetTypeName(rule.betType)}
                    </span>
                  </td>
                  <td className="num-cell">{rule.samples}</td>
                  <td className="num-cell">{rule.hits}</td>
                  <td className="num-cell">{rule.hitRate}%</td>
                  <td className={`num-cell recovery ${rule.recovery >= 100 ? 'positive' : 'negative'}`}>
                    {rule.recovery}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// 本日タブ
function TodayTab({ races }) {
  if (!races || races.length === 0) {
    return (
      <div className="today-tab">
        <div className="empty-state">
          <p>本日適用されたルールはありません。</p>
        </div>
      </div>
    )
  }

  // 会場ごとにグループ化
  const racesByVenue = useMemo(() => {
    const grouped = {}
    races.forEach(race => {
      if (!grouped[race.venueCode]) {
        grouped[race.venueCode] = {
          venueCode: race.venueCode,
          venueName: race.venueName,
          races: []
        }
      }
      grouped[race.venueCode].races.push(race)
    })
    return Object.values(grouped).sort((a, b) => a.venueCode.localeCompare(b.venueCode))
  }, [races])

  // 本日の集計
  const todaySummary = useMemo(() => {
    let total = 0
    let hits = 0
    let payout = 0
    races.forEach(race => {
      if (race.hitInfo) {
        total++
        if (race.hitInfo.hit) {
          hits++
          payout += race.hitInfo.payout
        }
      }
    })
    const investment = total * 100
    const recovery = investment > 0 ? Math.round((payout / investment) * 100) : 0
    return { total, hits, investment, payout, recovery }
  }, [races])

  return (
    <div className="today-tab">
      <div className="today-summary">
        <h3>本日の成績</h3>
        <div className="summary-stats">
          <div className="stat-item">
            <span className="stat-label">適用レース</span>
            <span className="stat-value">{races.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">結果確定</span>
            <span className="stat-value">{todaySummary.total}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">的中</span>
            <span className="stat-value">{todaySummary.hits}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">投資</span>
            <span className="stat-value">{todaySummary.investment.toLocaleString()}円</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">回収</span>
            <span className="stat-value">{todaySummary.payout.toLocaleString()}円</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">回収率</span>
            <span className={`stat-value recovery ${todaySummary.recovery >= 100 ? 'positive' : 'negative'}`}>
              {todaySummary.recovery}%
            </span>
          </div>
        </div>
      </div>

      <div className="today-races">
        {racesByVenue.map(venue => (
          <div key={venue.venueCode} className="venue-group">
            <h4 className="venue-group-header">{venue.venueName}</h4>
            <div className="race-cards">
              {venue.races.map(race => (
                <div
                  key={race.raceId}
                  className={`race-card ${race.hitInfo?.hit ? 'hit' : ''} ${race.result ? 'finished' : ''}`}
                >
                  <div className="race-card-header">
                    <span className="race-no">{race.raceNo}R</span>
                    {race.startTime && <span className="race-time">{race.startTime}</span>}
                  </div>
                  <div className="race-card-body">
                    <div className="prediction-info">
                      <span className="prediction-label">予測:</span>
                      <span className="prediction-value">
                        {race.prediction.top3.join('-')}
                      </span>
                    </div>
                    <div className="rules-info">
                      {race.rules.map(rule => (
                        <span key={rule.id} className={`rule-tag ${rule.betType}`}>
                          {rule.id} ({getBetTypeName(rule.betType)})
                        </span>
                      ))}
                    </div>
                  </div>
                  {race.result && (
                    <div className={`race-card-result ${race.hitInfo?.hit ? 'hit' : 'miss'}`}>
                      <span className="result-label">結果:</span>
                      <span className="result-value">
                        {race.result.rank1}-{race.result.rank2}-{race.result.rank3}
                      </span>
                      {race.hitInfo?.hit && (
                        <span className="payout">+{race.hitInfo.payout.toLocaleString()}円</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 履歴タブ
function HistoryTab({
  historyData,
  historyTotal,
  historyPage,
  pageSize,
  onPageChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange
}) {
  const totalPages = Math.ceil(historyTotal / pageSize)

  // 期間内のサマリーを計算
  const periodSummary = useMemo(() => {
    const samples = historyData.length
    const hits = historyData.filter(item => item.isHit).length
    const totalPayout = historyData.reduce((sum, item) => sum + (item.payout || 0), 0)
    const investment = samples * 100
    const recovery = investment > 0 ? Math.round((totalPayout / investment) * 100) : 0
    return { samples, hits, totalPayout, investment, recovery }
  }, [historyData])

  return (
    <div className="history-tab">
      <div className="history-filters">
        <div className="filter-group">
          <label>開始日:</label>
          <input
            type="date"
            value={startDate}
            onChange={e => {
              onStartDateChange(e.target.value)
              onPageChange(0)
            }}
          />
        </div>
        <div className="filter-group">
          <label>終了日:</label>
          <input
            type="date"
            value={endDate}
            onChange={e => {
              onEndDateChange(e.target.value)
              onPageChange(0)
            }}
          />
        </div>
      </div>

      <div className="history-summary">
        <div className="summary-row">
          <span className="summary-label">期間成績:</span>
          <span className="summary-value">
            投資 {periodSummary.investment.toLocaleString()}円 → 回収 {periodSummary.totalPayout.toLocaleString()}円
          </span>
          <span className={`recovery-badge ${periodSummary.recovery >= 100 ? 'positive' : 'negative'}`}>
            回収率 {periodSummary.recovery}%
          </span>
        </div>
        <div className="summary-detail">
          ルール適用数: {periodSummary.samples}件 / 的中数: {periodSummary.hits}件 ({periodSummary.samples > 0 ? Math.round((periodSummary.hits / periodSummary.samples) * 100) : 0}%)
        </div>
      </div>

      <div className="table-wrapper">
        <table className="rules-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>会場</th>
              <th>R</th>
              <th>ルールID</th>
              <th>種別</th>
              <th>予測</th>
              <th>結果</th>
              <th>的中</th>
              <th>配当</th>
            </tr>
          </thead>
          <tbody>
            {historyData.map((item, idx) => (
              <tr key={`${item.raceId}-${item.ruleId}-${idx}`}>
                <td>{item.date}</td>
                <td>{item.venueName}</td>
                <td className="num-cell">{item.raceNo}R</td>
                <td className="rule-id">{item.ruleId}</td>
                <td>
                  <span className={`bet-type-badge small ${item.betType}`}>
                    {getBetTypeName(item.betType)}
                  </span>
                </td>
                <td className="num-cell">{item.prediction}</td>
                <td className="num-cell">{item.result || '-'}</td>
                <td className={`num-cell ${item.isHit ? 'recovery positive' : 'recovery negative'}`}>
                  {item.result ? (item.isHit ? '○' : '×') : '-'}
                </td>
                <td className={`num-cell ${item.isHit ? 'recovery positive' : ''}`}>
                  {item.isHit ? `+${item.payout.toLocaleString()}円` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={historyPage === 0}
            onClick={() => onPageChange(historyPage - 1)}
          >
            前へ
          </button>
          <span className="page-info">{historyPage + 1} / {totalPages}</span>
          <button
            disabled={historyPage >= totalPages - 1}
            onClick={() => onPageChange(historyPage + 1)}
          >
            次へ
          </button>
        </div>
      )}
    </div>
  )
}

export default AdminRules
