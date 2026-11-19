import { useMemo } from "react";
import { getBetTypeName } from "../../services/ruleMatchService";
import InlineFetchError from "../../components/InlineFetchError";

// 本日タブ
function TodayTab({ races }) {
  // hooks は早期 return より前で毎回同じ順に呼ぶ（rules-of-hooks）。races が空・null のときは空の集計になる
  // 会場ごとにグループ化
  const racesByVenue = useMemo(() => {
    const grouped = {};
    for (const race of races ?? []) {
      if (!grouped[race.venueCode]) {
        grouped[race.venueCode] = {
          venueCode: race.venueCode,
          venueName: race.venueName,
          races: [],
        };
      }
      grouped[race.venueCode].races.push(race);
    }
    return Object.values(grouped).sort((a, b) =>
      a.venueCode.localeCompare(b.venueCode),
    );
  }, [races]);

  // 本日の集計
  const todaySummary = useMemo(() => {
    let total = 0;
    let hits = 0;
    let payout = 0;
    for (const race of races ?? []) {
      if (race.hitInfo) {
        total++;
        if (race.hitInfo.hit) {
          hits++;
          payout += race.hitInfo.payout;
        }
      }
    }
    const investment = total * 100;
    const recovery =
      investment > 0 ? Math.round((payout / investment) * 100) : 0;
    return { total, hits, investment, payout, recovery };
  }, [races]);

  if (!races || races.length === 0) {
    return (
      <div className="today-tab">
        <div className="empty-state">
          <p>本日適用されたルールはありません。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="today-tab">
      <TodaySummary races={races} todaySummary={todaySummary} />

      <div className="today-races">
        {racesByVenue.map((venue) => (
          <TodayVenueGroup key={venue.venueCode} venue={venue} />
        ))}
      </div>
    </div>
  );
}

// 本日の成績
function TodaySummary({ races, todaySummary }) {
  return (
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
          <span className="stat-value">
            {todaySummary.investment.toLocaleString()}円
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">回収</span>
          <span className="stat-value">
            {todaySummary.payout.toLocaleString()}円
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">回収率</span>
          <span
            className={`stat-value recovery ${todaySummary.recovery >= 100 ? "positive" : "negative"}`}
          >
            {todaySummary.recovery}%
          </span>
        </div>
      </div>
    </div>
  );
}

// 会場ごとのレース一覧
function TodayVenueGroup({ venue }) {
  return (
    <div className="venue-group">
      <h4 className="venue-group-header">{venue.venueName}</h4>
      <div className="race-cards">
        {venue.races.map((race) => (
          <TodayRaceCard key={race.raceId} race={race} />
        ))}
      </div>
    </div>
  );
}

// レースカード
function TodayRaceCard({ race }) {
  return (
    <div
      className={`race-card ${race.hitInfo?.hit ? "hit" : ""} ${race.result ? "finished" : ""}`}
    >
      <div className="race-card-header">
        <span className="race-no">{race.raceNo}R</span>
        {race.startTime && <span className="race-time">{race.startTime}</span>}
      </div>
      <div className="race-card-body">
        <div className="prediction-info">
          <span className="prediction-label">予測:</span>
          <span className="prediction-value">
            {race.prediction.top3.join("-")}
          </span>
        </div>
        <div className="rules-info">
          {race.rules.map((rule) => (
            <span key={rule.id} className={`rule-tag ${rule.betType}`}>
              {rule.id} ({getBetTypeName(rule.betType)})
            </span>
          ))}
        </div>
      </div>
      {race.result && (
        <div
          className={`race-card-result ${race.hitInfo?.hit ? "hit" : "miss"}`}
        >
          <span className="result-label">結果:</span>
          <span className="result-value">
            {race.result.rank1}-{race.result.rank2}-{race.result.rank3}
          </span>
          {race.hitInfo?.hit && (
            <span className="payout">
              +{race.hitInfo.payout.toLocaleString()}円
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// 履歴タブ
function HistoryTab({
  historyData,
  historyTotal,
  historyError,
  onRetryHistory,
  historyPage,
  pageSize,
  onPageChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}) {
  const totalPages = Math.ceil(historyTotal / pageSize);

  // 期間内のサマリーを計算
  const periodSummary = useMemo(() => {
    const samples = historyData.length;
    const hits = historyData.filter((item) => item.isHit).length;
    const totalPayout = historyData.reduce(
      (sum, item) => sum + (item.payout || 0),
      0,
    );
    const investment = samples * 100;
    const recovery =
      investment > 0 ? Math.round((totalPayout / investment) * 100) : 0;
    return { samples, hits, totalPayout, investment, recovery };
  }, [historyData]);

  return (
    <div className="history-tab">
      <HistoryFilters
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
        onPageChange={onPageChange}
      />

      {historyError ? (
        <InlineFetchError message={historyError} onRetry={onRetryHistory} />
      ) : (
        <>
          <HistorySummary periodSummary={periodSummary} />
          <HistoryTable historyData={historyData} />
          {totalPages > 1 && (
            <HistoryPagination
              historyPage={historyPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  );
}

// 履歴タブ: 期間の絞り込み
function HistoryFilters({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onPageChange,
}) {
  return (
    <div className="history-filters">
      <div className="filter-group">
        <label>開始日:</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            onStartDateChange(e.target.value);
            onPageChange(0);
          }}
        />
      </div>
      <div className="filter-group">
        <label>終了日:</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            onEndDateChange(e.target.value);
            onPageChange(0);
          }}
        />
      </div>
    </div>
  );
}

// 履歴タブ: 期間成績
function HistorySummary({ periodSummary }) {
  return (
    <div className="history-summary">
      <div className="summary-row">
        <span className="summary-label">期間成績:</span>
        <span className="summary-value">
          投資 {periodSummary.investment.toLocaleString()}円 → 回収{" "}
          {periodSummary.totalPayout.toLocaleString()}円
        </span>
        <span
          className={`recovery-badge ${periodSummary.recovery >= 100 ? "positive" : "negative"}`}
        >
          回収率 {periodSummary.recovery}%
        </span>
      </div>
      <div className="summary-detail">
        ルール適用数: {periodSummary.samples}件 / 的中数: {periodSummary.hits}件
        (
        {periodSummary.samples > 0
          ? Math.round((periodSummary.hits / periodSummary.samples) * 100)
          : 0}
        %)
      </div>
    </div>
  );
}

// 履歴タブ: 履歴の表
function HistoryTable({ historyData }) {
  return (
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
              <td className="num-cell">{item.result || "-"}</td>
              <td
                className={`num-cell ${item.isHit ? "recovery positive" : "recovery negative"}`}
              >
                {item.result ? (item.isHit ? "○" : "×") : "-"}
              </td>
              <td
                className={`num-cell ${item.isHit ? "recovery positive" : ""}`}
              >
                {item.isHit ? `+${item.payout.toLocaleString()}円` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 履歴タブ: ページ送り
function HistoryPagination({ historyPage, totalPages, onPageChange }) {
  return (
    <div className="pagination">
      <button
        disabled={historyPage === 0}
        onClick={() => onPageChange(historyPage - 1)}
      >
        前へ
      </button>
      <span className="page-info">
        {historyPage + 1} / {totalPages}
      </span>
      <button
        disabled={historyPage >= totalPages - 1}
        onClick={() => onPageChange(historyPage + 1)}
      >
        次へ
      </button>
    </div>
  );
}

export { TodayTab, HistoryTab };
