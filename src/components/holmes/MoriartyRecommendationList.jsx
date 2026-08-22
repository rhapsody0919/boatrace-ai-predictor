function RecommendationCard({ rec }) {
  const evDisplay =
    rec.expected_value != null ? rec.expected_value.toFixed(2) : "—";
  const fractionDisplay =
    rec.bet_fraction != null ? `${(rec.bet_fraction * 100).toFixed(1)}%` : "—";

  let hitLabel = null;
  if (rec.actual_hit === true)
    hitLabel = { text: "的中", color: "var(--color-success-text)" };
  else if (rec.actual_hit === false)
    hitLabel = { text: "外れ", color: "var(--color-error-text)" };

  const reasons = Array.isArray(rec.reasons) ? rec.reasons : [];

  return (
    <div className="moriarty-rec-card">
      <div className="moriarty-rec-header">
        <span className="moriarty-rec-venue">
          {rec.venue} {rec.race_no != null ? `${rec.race_no}R` : ""}
        </span>
        {hitLabel && (
          <span className="moriarty-rec-hit" style={{ color: hitLabel.color }}>
            {hitLabel.text}
          </span>
        )}
      </div>
      <div className="moriarty-rec-metrics">
        <div className="moriarty-rec-metric">
          <span className="moriarty-rec-metric-label">EV</span>
          <span className="moriarty-rec-metric-value">{evDisplay}</span>
        </div>
        <div className="moriarty-rec-metric">
          <span className="moriarty-rec-metric-label">Kelly比率</span>
          <span className="moriarty-rec-metric-value">{fractionDisplay}</span>
        </div>
        {rec.actual_payout != null && (
          <div className="moriarty-rec-metric">
            <span className="moriarty-rec-metric-label">払戻</span>
            <span className="moriarty-rec-metric-value">
              {rec.actual_payout}円
            </span>
          </div>
        )}
      </div>
      {reasons.length > 0 && (
        <ul className="moriarty-rec-reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoriartyRecommendationList({ recommendations = [] }) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <div className="moriarty-rec-empty">
        <p>本日は見送り推奨（EV &gt; 1.0 のレースなし）</p>
        <p className="moriarty-rec-empty-sub">
          期待値が基準を超えるレースのみ推奨します。見送りも戦略のひとつです。
        </p>
      </div>
    );
  }

  return (
    <div className="moriarty-rec-list">
      {recommendations.map((rec) => (
        <RecommendationCard key={rec.race_id} rec={rec} />
      ))}
    </div>
  );
}

export default MoriartyRecommendationList;
