import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./RacerPerformanceStats.css";

const TECHNIQUE_COLORS = {
  逃げ: "#0ea5e9",
  差し: "#10b981",
  まくり: "#f59e0b",
  まくり差し: "#ef4444",
  抜き: "#8b5cf6",
  恵まれ: "#94a3b8",
};

function techniqueColor(technique) {
  return TECHNIQUE_COLORS[technique] ?? "#94a3b8";
}

/**
 * 選手個別ページの成績・調子セクション
 * 選手調子（全国勝率推移）・平均ST・決まり手傾向をまとめて表示する。
 * データが一切無い選手（デビュー直後等）ではセクション自体を非表示にする。
 * profile/grade/newsとは別経路で取得するため、読み込み中は簡易表示にする
 */
export default function RacerPerformanceStats({ stats, loading }) {
  const { formSummary, formTrend, techniqueProfile, aggregatedStats } =
    stats ?? {};

  const chartData = (formTrend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    national_win_rate: row.win_rate,
    local_win_rate: row.local_win_rate,
  }));

  const hasTechniques = (techniqueProfile?.techniques?.length ?? 0) > 0;

  const hasAnyData =
    formSummary != null ||
    chartData.length > 0 ||
    hasTechniques ||
    aggregatedStats != null;

  if (loading) {
    return (
      <div className="racer-performance-stats">
        <h2>成績・調子</h2>
        <p className="racer-stat-loading">読み込み中...</p>
      </div>
    );
  }

  if (!hasAnyData) return null;

  return (
    <div className="racer-performance-stats">
      <h2>成績・調子</h2>

      <div className="racer-stat-cards-grid">
        {formSummary && (
          <div className="racer-stat-card">
            <h3>選手調子（全国勝率）</h3>
            <div className="racer-stat-value-row">
              <span className="racer-stat-value">
                {formSummary.current_win_rate?.toFixed(2)}
              </span>
              {formSummary.delta !== null && (
                <span
                  className={`racer-stat-delta ${
                    formSummary.delta > 0
                      ? "racer-stat-delta-up"
                      : formSummary.delta < 0
                        ? "racer-stat-delta-down"
                        : ""
                  }`}
                >
                  {formSummary.delta > 0
                    ? "↑"
                    : formSummary.delta < 0
                      ? "↓"
                      : "→"}{" "}
                  {Math.abs(formSummary.delta).toFixed(2)}
                </span>
              )}
            </div>
            <p className="racer-stat-note">
              約90日前:{" "}
              {formSummary.past_win_rate !== null
                ? formSummary.past_win_rate.toFixed(2)
                : "データなし"}
            </p>
          </div>
        )}

        {aggregatedStats?.avg_st != null && (
          <div className="racer-stat-card">
            <h3>平均ST</h3>
            <div className="racer-stat-value-row">
              <span className="racer-stat-value">
                {Number(aggregatedStats.avg_st).toFixed(3)}
              </span>
              {aggregatedStats.flying_rate > 0 && (
                <span className="racer-stat-sub">
                  F率 {(aggregatedStats.flying_rate * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="racer-stat-note">
              直近30走平均:{" "}
              {aggregatedStats.avg_st_last_30 != null
                ? Number(aggregatedStats.avg_st_last_30).toFixed(3)
                : "-"}
              （全{aggregatedStats.total_races}走）
            </p>
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="racer-stat-chart">
          <h3>全国勝率・当地勝率の推移</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => value?.toFixed(2)} />
              <Legend />
              <Line
                type="stepAfter"
                dataKey="national_win_rate"
                name="全国勝率"
                stroke="var(--brand-accent-primary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                type="stepAfter"
                dataKey="local_win_rate"
                name="当地勝率"
                stroke="var(--brand-accent-secondary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasTechniques && (
        <div className="racer-technique-profile">
          <h3>決まり手傾向（過去90日・勝利時）</h3>
          <div className="racer-technique-bar" translate="no">
            {techniqueProfile.techniques.map((tech) => (
              <div
                key={tech.technique}
                className="racer-technique-bar-segment"
                style={{
                  width: `${tech.percentage}%`,
                  background: techniqueColor(tech.technique),
                }}
                title={`${tech.technique} ${tech.percentage.toFixed(1)}%`}
              />
            ))}
          </div>
          <ul className="racer-technique-legend" translate="no">
            {techniqueProfile.techniques.map((tech) => (
              <li key={tech.technique}>
                <span
                  className="racer-technique-dot"
                  style={{ background: techniqueColor(tech.technique) }}
                />
                {tech.technique} {tech.percentage.toFixed(0)}%（{tech.count}
                回）
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
