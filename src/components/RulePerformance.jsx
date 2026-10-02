/**
 * RulePerformance - 会場別ルールのパフォーマンスダッシュボード
 */

import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabaseDataService'
import { getBetTypeName, getReliabilityName } from '../services/ruleMatchService'
import { errorMessageOf } from "../utils/errorMessage.js";

function RulePerformance() {
  const [rules, setRules] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVenue, setSelectedVenue] = useState('all')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    if (!isSupabaseConfigured()) {
      setError('Supabaseが設定されていません')
      setLoading(false)
      return
    }

    try {
      // ルール一覧を取得
      const { data: rulesData, error: rulesError } = await supabase
        .from('venue_rules')
        .select('*')
        .eq('is_active', true)
        .order('expected_recovery', { ascending: false })

      if (rulesError) throw rulesError

      // 直近30日の適用ログを取得
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
      const { data: appsData, error: appsError } = await supabase
        .from('rule_applications')
        .select('*')
        .gte('created_at', thirtyDaysAgo)

      if (appsError) throw appsError

      setRules(rulesData || [])
      setApplications(appsData || [])
    } catch (e) {
      setError(errorMessageOf(e))
    } finally {
      setLoading(false)
    }
  }

  // ルールごとの実績を集計
  function calculateRuleStats(ruleId) {
    const ruleApps = applications.filter(a => a.rule_id === ruleId && a.is_hit !== null)
    if (ruleApps.length === 0) return null

    const total = ruleApps.length
    const hits = ruleApps.filter(a => a.is_hit).length
    const totalPayout = ruleApps.reduce((sum, a) => sum + (a.payout || 0), 0)
    const totalBet = total * 100
    const hitRate = ((hits / total) * 100).toFixed(1)
    const recoveryRate = ((totalPayout / totalBet) * 100).toFixed(1)
    const profit = totalPayout - totalBet

    return { total, hits, hitRate, recoveryRate, profit }
  }

  // 会場一覧を取得
  const venues = [...new Set(rules.map(r => r.venue_code))].sort()

  // フィルタリング
  const filteredRules = selectedVenue === 'all'
    ? rules
    : rules.filter(r => r.venue_code === selectedVenue)

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
        <p>エラー: {error}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '1rem' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1rem' }}>
        ルールパフォーマンス（直近30日）
      </h2>

      {/* 会場フィルター */}
      <div style={{ marginBottom: '1rem' }}>
        <select
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          style={{
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc',
            fontSize: '0.9rem'
          }}
        >
          <option value="all">全会場</option>
          {venues.map(v => (
            <option key={v} value={v}>会場 {v}</option>
          ))}
        </select>
      </div>

      {/* ルール一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredRules.map(rule => {
          const stats = calculateRuleStats(rule.rule_id)
          const isProfit = stats && parseFloat(stats.recoveryRate) >= 100

          return (
            <div
              key={rule.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '0.75rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{
                    background: rule.bet_type === 'trio' ? '#f5576c' : rule.bet_type === 'win' ? '#4facfe' : '#764ba2',
                    color: 'white',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    marginRight: '0.5rem'
                  }}>
                    {getBetTypeName(rule.bet_type)}
                  </span>
                  <strong>{rule.rule_id}</strong>
                </div>
                <span style={{
                  background: rule.reliability === 'highest' ? '#10b981' : rule.reliability === 'high' ? '#3b82f6' : '#f59e0b',
                  color: 'white',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '4px',
                  fontSize: '0.65rem'
                }}>
                  {getReliabilityName(rule.reliability)}
                </span>
              </div>

              <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                {rule.description}
              </p>

              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                <div>
                  <span style={{ color: '#6b7280' }}>期待回収: </span>
                  <strong style={{ color: '#10b981' }}>{rule.expected_recovery}%</strong>
                </div>
                {stats ? (
                  <>
                    <div>
                      <span style={{ color: '#6b7280' }}>実績: </span>
                      <strong style={{ color: isProfit ? '#10b981' : '#ef4444' }}>{stats.recoveryRate}%</strong>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>的中: </span>
                      <strong>{stats.hits}/{stats.total}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>損益: </span>
                      <strong style={{ color: stats.profit >= 0 ? '#10b981' : '#ef4444' }}>
                        {stats.profit >= 0 ? '+' : ''}{stats.profit}円
                      </strong>
                    </div>
                  </>
                ) : (
                  <span style={{ color: '#9ca3af' }}>実績なし</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filteredRules.length === 0 && (
        <p style={{ textAlign: 'center', color: '#6b7280', marginTop: '2rem' }}>
          ルールが登録されていません
        </p>
      )}
    </div>
  )
}

export default RulePerformance
