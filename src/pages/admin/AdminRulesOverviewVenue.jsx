import { useMemo } from "react";
import { getBetTypeName, getVenueName } from "../../services/ruleMatchService";

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
              const barHeight = Math.min(
                Math.max((week.cumulativeRecovery / 100) * 80, 20),
                120,
              );
              return (
                <div key={idx} className="week-bar-container">
                  <div
                    className={`week-bar ${week.cumulativeRecovery >= 100 ? "positive" : "negative"}`}
                    style={{ height: `${barHeight}px` }}
                  >
                    <span className="bar-value">
                      {week.cumulativeRecovery}%
                    </span>
                  </div>
                  <span className="week-label">{week.weekLabel}</span>
                </div>
              );
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
                  className={`sortable ${sortKey === "ruleId" ? "sorted" : ""}`}
                  onClick={() => onSort("ruleId")}
                >
                  ルールID {sortKey === "ruleId" && (sortDesc ? "▼" : "▲")}
                </th>
                <th>会場</th>
                <th>条件</th>
                <th>種別</th>
                <th
                  className={`sortable ${sortKey === "samples" ? "sorted" : ""}`}
                  onClick={() => onSort("samples")}
                >
                  サンプル数 {sortKey === "samples" && (sortDesc ? "▼" : "▲")}
                </th>
                <th>的中数</th>
                <th
                  className={`sortable ${sortKey === "hitRate" ? "sorted" : ""}`}
                  onClick={() => onSort("hitRate")}
                >
                  的中率 {sortKey === "hitRate" && (sortDesc ? "▼" : "▲")}
                </th>
                <th
                  className={`sortable ${sortKey === "recovery" ? "sorted" : ""}`}
                  onClick={() => onSort("recovery")}
                >
                  回収率 {sortKey === "recovery" && (sortDesc ? "▼" : "▲")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
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
                  <td
                    className={`num-cell recovery ${rule.recovery >= 100 ? "positive" : "negative"}`}
                  >
                    {rule.recovery}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 会場別タブ
function VenueTab({
  venues,
  selectedVenue,
  onVenueChange,
  venueTotal,
  allRules,
}) {
  // 会場別に集計したルール
  const venueRules = useMemo(() => {
    if (selectedVenue === "all") return allRules;
    return allRules.filter((r) => r.venueCode === selectedVenue);
  }, [allRules, selectedVenue]);

  return (
    <div className="venue-tab">
      <div className="venue-selector">
        <label>会場を選択:</label>
        <select
          value={selectedVenue}
          onChange={(e) => onVenueChange(e.target.value)}
        >
          <option value="all">全会場</option>
          {venues.map((v) => (
            <option key={v.code} value={v.code}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {selectedVenue !== "all" && venueTotal && (
        <VenueSummary selectedVenue={selectedVenue} venueTotal={venueTotal} />
      )}

      <VenueRulesTable selectedVenue={selectedVenue} venueRules={venueRules} />
    </div>
  );
}

// 会場別タブの会場成績サマリー
function VenueSummary({ selectedVenue, venueTotal }) {
  return (
    <div className="venue-summary">
      <h3>{getVenueName(selectedVenue)} の運用成績</h3>
      <div className="venue-stats">
        <div className="stat-item">
          <span className="stat-label">対象件数</span>
          <span className="stat-value">{venueTotal.samples}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">的中数</span>
          <span className="stat-value">{venueTotal.hits}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">的中率</span>
          <span className="stat-value">{venueTotal.hitRate}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">回収率</span>
          <span
            className={`stat-value recovery ${venueTotal.recovery >= 100 ? "positive" : "negative"}`}
          >
            {venueTotal.recovery}%
          </span>
        </div>
      </div>
    </div>
  );
}

// 会場別タブのルール一覧
function VenueRulesTable({ selectedVenue, venueRules }) {
  return (
    <div className="rules-table-section">
      <h3>
        {selectedVenue === "all" ? "全会場" : getVenueName(selectedVenue)}
        のルール一覧 ({venueRules.length}件)
      </h3>
      <div className="table-wrapper">
        <table className="rules-table">
          <thead>
            <tr>
              <th>ルールID</th>
              {selectedVenue === "all" && <th>会場</th>}
              <th>条件</th>
              <th>種別</th>
              <th>サンプル数</th>
              <th>的中数</th>
              <th>的中率</th>
              <th>回収率</th>
            </tr>
          </thead>
          <tbody>
            {venueRules.map((rule) => (
              <tr key={rule.ruleId}>
                <td className="rule-id">{rule.ruleId}</td>
                {selectedVenue === "all" && <td>{rule.venueName}</td>}
                <td className="rule-desc">{rule.description}</td>
                <td>
                  <span className={`bet-type-badge ${rule.betType}`}>
                    {getBetTypeName(rule.betType)}
                  </span>
                </td>
                <td className="num-cell">{rule.samples}</td>
                <td className="num-cell">{rule.hits}</td>
                <td className="num-cell">{rule.hitRate}%</td>
                <td
                  className={`num-cell recovery ${rule.recovery >= 100 ? "positive" : "negative"}`}
                >
                  {rule.recovery}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { OverviewTab, VenueTab };
