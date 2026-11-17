/** 展開予測の会場別の表（byVenue が空なら呼び出し側で出さない） */
export default function AccuracyDashboardVenueDetails({ byVenue }) {
  return (
    <details className="turn-accuracy-venue-details">
      <summary>会場別の的中率を見る</summary>
      <div className="table-wrapper">
        <table className="turn-accuracy-venue-table">
          <thead>
            <tr>
              <th>会場</th>
              <th>展開予測 的中率</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {byVenue.map((v) => (
              <tr key={v.venueCode} style={{ opacity: v.isReliable ? 1 : 0.7 }}>
                <td className="turn-accuracy-venue-table__name">
                  {v.venueName}
                </td>
                <td>
                  {v.hitRate.toFixed(1)}%
                  {!v.isReliable && (
                    <span className="turn-accuracy-venue-ref-note"> ※</span>
                  )}
                </td>
                <td>{v.totalRaces}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="turn-accuracy-venue-ref-desc">
        ※ サンプル数が20件未満のため参考値
      </p>
    </details>
  );
}
