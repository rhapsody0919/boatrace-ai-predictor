function MoriartyStatsHeader({ stats }) {
  const {
    operation_days = 0,
    total_bets = 0,
    cumulative_roi = 0,
    win_rate = 0,
  } = stats || {};

  const roiPercent = Math.round(cumulative_roi * 1000) / 10;
  const winRatePercent = Math.round(win_rate * 1000) / 10;
  const roiColor =
    roiPercent >= 100
      ? "var(--color-success-text)"
      : roiPercent >= 80
        ? "var(--color-warning-text)"
        : "var(--color-error-text)";

  return (
    <div className="moriarty-stats-header">
      <div className="moriarty-stat-card">
        <div className="moriarty-stat-value">{operation_days}</div>
        <div className="moriarty-stat-label">運用日数</div>
      </div>
      <div className="moriarty-stat-card">
        <div className="moriarty-stat-value">{total_bets}</div>
        <div className="moriarty-stat-label">累積推奨レース</div>
      </div>
      <div className="moriarty-stat-card">
        <div className="moriarty-stat-value" style={{ color: roiColor }}>
          {roiPercent}%
        </div>
        <div className="moriarty-stat-label">累積回収率</div>
      </div>
      <div className="moriarty-stat-card">
        <div className="moriarty-stat-value">{winRatePercent}%</div>
        <div className="moriarty-stat-label">的中率</div>
      </div>
    </div>
  );
}

export default MoriartyStatsHeader;
