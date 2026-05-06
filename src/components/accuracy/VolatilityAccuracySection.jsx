/**
 * VolatilityAccuracySection - イン崩れ予測精度セクション
 */

const LEVEL_CONFIG = {
  low: { label: "🎯 本命有利", color: "#4caf50", bg: "#e8f5e9" },
  medium: { label: "⚖️ 標準", color: "#2196f3", bg: "#e3f2fd" },
  high: { label: "🌪️ イン崩れ確率高", color: "#ff9800", bg: "#fff3e0" },
};

const GRADE_DISPLAY = {
  SG: { label: "SG", color: "#7c3aed" },
  G1: { label: "G1", color: "#dc2626" },
  G2: { label: "G2", color: "#2563eb" },
  G3: { label: "G3", color: "#059669" },
  ippan: { label: "一般", color: "#64748b" },
};

function LevelBar({ level, data, baseline }) {
  if (!data) return null;
  const cfg = LEVEL_CONFIG[level];
  const BAR_MAX = 80;
  const barWidth = Math.min(100, (data.upsetRate / BAR_MAX) * 100);
  const baselinePos = Math.min(100, (baseline.upsetRate / BAR_MAX) * 100);

  return (
    <div className="vas-row">
      <div className="vas-label">{cfg.label}</div>
      <div className="vas-bar-wrap">
        <div className="vas-bar-track">
          <div
            className="vas-bar-fill"
            style={{ width: `${barWidth}%`, background: cfg.color }}
          />
          <div
            className="vas-baseline-marker"
            style={{ left: `${baselinePos}%` }}
            title={`全体平均 ${baseline.upsetRate.toFixed(1)}%`}
          />
        </div>
        <div className="vas-rate" style={{ color: cfg.color }}>
          {data.upsetRate.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function GradeTable({ byGrade, baseline }) {
  if (!byGrade || Object.keys(byGrade).length === 0) return null;
  const grades = ["SG", "G1", "G2", "G3", "ippan"].filter((g) => byGrade[g]);

  return (
    <details className="vas-grade-details">
      <summary>グレード別の詳細を見る</summary>
      <div className="table-wrapper">
        <table className="volatility-grade-table">
          <thead>
            <tr>
              <th>グレード</th>
              <th>イン崩れ確率高ラベル時の<br/>1コース負け確率</th>
              <th>会場全体の<br/>1コース負け確率平均</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((grade) => {
              const d = byGrade[grade];
              const cfg = GRADE_DISPLAY[grade];
              const isRef = d.highRaceCount < 30;
              return (
                <tr key={grade}>
                  <td style={{ fontWeight: 700, color: cfg.color }}>{cfg.label}</td>
                  <td style={{ fontWeight: 600, color: "#ff9800" }}>
                    {d.highUpsetRate != null ? `${d.highUpsetRate.toFixed(1)}%` : "-"}
                    {isRef && <span className="vas-ref-note"> ※</span>}
                  </td>
                  <td>{d.upsetRate.toFixed(1)}%</td>
                  <td>{d.highRaceCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="vas-ref-desc">※ サンプル数が30件未満のため参考値</p>
      </div>
    </details>
  );
}

function VolatilityAccuracySection({ stats }) {
  if (!stats) return null;
  const { baseline, byLevel, byVenue, byGrade } = stats;
  if (!baseline || !byLevel) return null;

  const highData = byLevel.high;

  return (
    <div className="volatility-accuracy-section">
      <h3>🌪️ イン崩れ予測の実績（直近90日）</h3>

      {/* ひと言サマリー */}
      {highData && (
        <p className="vas-summary">
          「イン崩れ確率高」ラベルが付与されたレースでは、実際に{" "}
          <strong style={{ color: "#ff9800", fontSize: "1.1em" }}>
            {highData.upsetRate.toFixed(1)}%
          </strong>{" "}
          の確率で1コース（1号艇）が1着になっていません
          <span className="vas-summary-sub">
            （全体平均: {baseline.upsetRate.toFixed(1)}%）
          </span>
        </p>
      )}

      {/* ラベル別バー */}
      <div className="vas-bars">
        {["low", "medium", "high"].map((level) => (
          <LevelBar
            key={level}
            level={level}
            data={byLevel[level]}
            baseline={baseline}
          />
        ))}
      </div>
      <div className="vas-legend">
        <span className="vas-legend-marker" />
        縦線 = 全体平均 {baseline.upsetRate.toFixed(1)}%
        <span className="vas-legend-count">
          （集計: {baseline.raceCount.toLocaleString()}レース）
        </span>
      </div>

      {/* グレード別テーブル */}
      <GradeTable byGrade={byGrade} baseline={baseline} />

      {/* 会場別テーブル（折りたたみ気味に小さく） */}
      {byVenue && byVenue.length > 0 && (
        <details className="vas-venue-details">
          <summary>会場別の詳細を見る</summary>
          <div className="table-wrapper">
            <table className="volatility-venue-table">
              <thead>
                <tr>
                  <th>会場</th>
                  <th>イン崩れ確率高ラベル時の<br/>1コース負け確率</th>
                  <th>会場全体の<br/>1コース負け確率平均</th>
                  <th>件数</th>
                </tr>
              </thead>
              <tbody>
                {byVenue.map((v) => (
                  <tr key={v.venueCode}>
                    <td className="volatility-venue-table__name">
                      {v.venueName}
                    </td>
                    <td style={{ fontWeight: 600, color: "#ff9800" }}>
                      {v.highUpsetRate.toFixed(1)}%
                    </td>
                    <td>{v.baselineUpsetRate.toFixed(1)}%</td>
                    <td>{v.highRaceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

export default VolatilityAccuracySection;
