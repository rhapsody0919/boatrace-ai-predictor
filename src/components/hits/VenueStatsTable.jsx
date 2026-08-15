/**
 * VenueStatsTable - ボートレース場別 展開予測的中統計テーブル（BOA-174、unified一本化）
 */

function VenueStatsTable({ venueStats }) {
  if (venueStats.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
        <p>選択期間に展開予測の的中レースがありません</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="venue-stats-table">
        <thead>
          <tr>
            <th>順位</th>
            <th>ボートレース場</th>
            <th className="text-right">展開予測 的中数</th>
          </tr>
        </thead>
        <tbody>
          {venueStats.map((stat, index) => (
            <tr key={stat.venue} className={index < 3 ? "top-3" : ""}>
              <td
                className={`rank-cell ${index === 0 ? "rank-1" : index === 1 ? "rank-2" : index === 2 ? "rank-3" : ""}`}
              >
                {index === 0 && "🏆"}
                {index === 1 && "🥈"}
                {index === 2 && "🥉"}
                {index > 2 && index + 1}
              </td>
              <td className="venue-name">{stat.venue}</td>
              <td className="hit-count text-right">{stat.hitCount}レース</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default VenueStatsTable;
