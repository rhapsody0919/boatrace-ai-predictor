/**
 * HitStats - 展開予測的中統計ボックスコンポーネント（BOA-174、unified一本化）
 */

function HitStats({ hitRaces }) {
  const venueCount = new Set(hitRaces.map((race) => race.venue)).size;

  return (
    <div className="stats-box">
      <div className="stats-flex">
        <div className="stat-item">
          <div className="stat-label">展開予測 的中数</div>
          <div className="stat-value">{hitRaces.length}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">的中した会場数</div>
          <div className="stat-value">{venueCount}</div>
        </div>
      </div>
    </div>
  );
}

export default HitStats;
