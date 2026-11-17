import { Link } from "react-router-dom";
import { formatDateObject } from "../utils/formatters";
import { getMonthSummary } from "./RaceHistoryLogic";

function DateCard({ dateInfo, inCaution }) {
  return (
    <Link to={`/races/${dateInfo.date}`} className="date-card">
      <div className="date-card-header">
        <h3>{formatDateObject(dateInfo.date).short}</h3>
        <span className="race-count">
          {dateInfo.finishedRaces}/{dateInfo.totalRaces} レース完了
        </span>
      </div>

      {!inCaution &&
        (dateInfo.turnHitRate != null ? (
          <div className="date-card-turn-stat">
            <span className="date-card-turn-stat-label">🌊 展開予測的中率</span>
            <span className="date-card-turn-stat-value">
              {dateInfo.turnHitRate}%
            </span>
            <span className="date-card-turn-stat-count">
              （{dateInfo.turnRaces}レース）
            </span>
          </div>
        ) : (
          <div className="date-card-turn-stat date-card-turn-stat-empty">
            この日のデータはまだありません
          </div>
        ))}

      <div className="date-card-footer">
        <span className="view-detail">詳細を見る →</span>
      </div>
    </Link>
  );
}

export function MonthGroup({ dates, isExpanded, inCaution, onToggle }) {
  const summary = getMonthSummary(dates);

  return (
    <div className="month-group">
      <div className="month-header" onClick={onToggle}>
        <div className="month-title">
          <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
          <h2>📅 {formatDateObject(dates[0].date).yearMonth}</h2>
        </div>
        <div className="month-summary">
          {summary.days}日分
          {!inCaution && summary.avgTurnHitRate != null
            ? ` | 展開予測的中率 ${summary.avgTurnHitRate}%`
            : ""}
        </div>
      </div>

      {isExpanded && (
        <div className="dates-list">
          {dates.map((dateInfo) => (
            <DateCard
              key={dateInfo.date}
              dateInfo={dateInfo}
              inCaution={inCaution}
            />
          ))}
        </div>
      )}
    </div>
  );
}
