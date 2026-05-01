/**
 * VolatilityAccuracySection - イン崩れ予測精度セクション
 * accuracy_cache の volatilityStats を受け取り、high/medium/low 別の飛び率を表示する
 */

const LEVEL_CONFIG = {
  low: { label: "本命有利", icon: "🎯", color: "#4caf50", bg: "#e8f5e9" },
  medium: { label: "標準", icon: "⚖️", color: "#2196f3", bg: "#e3f2fd" },
  high: {
    label: "イン崩れ確率高",
    icon: "🌪️",
    color: "#ff9800",
    bg: "#fff3e0",
  },
};

function VolatilityAccuracySection({ stats }) {
  if (!stats) return null;

  const { baseline, byLevel, byVenue } = stats;
  if (!baseline || !byLevel) return null;

  return (
    <div className="volatility-accuracy-section">
      <h3>🌪️ イン崩れ予測 精度（直近90日）</h3>

      {/* サマリーカード */}
      <div className="volatility-accuracy-cards">
        <div className="volatility-accuracy-card volatility-accuracy-card--baseline">
          <div className="vac-label">全体ベースライン</div>
          <div className="vac-rate" style={{ color: "#64748b" }}>
            {baseline.upsetRate.toFixed(1)}%
          </div>
          <div className="vac-sub">1コース飛び率</div>
          <div className="vac-count">
            N={baseline.raceCount.toLocaleString()}
          </div>
        </div>

        {["low", "medium", "high"].map((level) => {
          const data = byLevel[level];
          if (!data) return null;
          const cfg = LEVEL_CONFIG[level];
          const liftSign = data.lift >= 0 ? "+" : "";
          return (
            <div
              key={level}
              className="volatility-accuracy-card"
              style={{
                borderTop: `3px solid ${cfg.color}`,
                background: cfg.bg,
              }}
            >
              <div className="vac-label">
                {cfg.icon} {cfg.label}
              </div>
              <div className="vac-rate" style={{ color: cfg.color }}>
                {data.upsetRate.toFixed(1)}%
              </div>
              <div className="vac-lift" style={{ color: cfg.color }}>
                ({liftSign}
                {data.lift.toFixed(1)}pt)
              </div>
              <div className="vac-count">
                N={data.raceCount.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      <p className="volatility-accuracy-note">
        ※ 飛び率 =
        1号艇が1着にならなかったレースの割合。カッコ内は全体ベースラインとの差分。
      </p>

      {/* 会場別テーブル */}
      {byVenue && byVenue.length > 0 && (
        <div className="volatility-venue-breakdown">
          <h4>会場別 イン崩れ確率高 の飛び率（N≥5）</h4>
          <div className="table-wrapper">
            <table className="volatility-venue-table">
              <thead>
                <tr>
                  <th>会場</th>
                  <th>high飛び率</th>
                  <th>全体ベース</th>
                  <th>差分</th>
                  <th>サンプル数</th>
                </tr>
              </thead>
              <tbody>
                {byVenue.map((v) => {
                  const diff = v.highUpsetRate - v.baselineUpsetRate;
                  const diffText = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pt`;
                  const diffColor =
                    diff >= 5 ? "#ff9800" : diff >= 0 ? "#4caf50" : "#64748b";
                  return (
                    <tr key={v.venueCode}>
                      <td className="venue-name-cell">{v.venueName}</td>
                      <td style={{ fontWeight: 600, color: "#ff9800" }}>
                        {v.highUpsetRate.toFixed(1)}%
                      </td>
                      <td>{v.baselineUpsetRate.toFixed(1)}%</td>
                      <td style={{ color: diffColor, fontWeight: 600 }}>
                        {diffText}
                      </td>
                      <td>{v.highRaceCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default VolatilityAccuracySection;
