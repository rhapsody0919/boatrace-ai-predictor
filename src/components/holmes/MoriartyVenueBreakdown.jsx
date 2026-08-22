import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

function MoriartyVenueBreakdown({ data = [] }) {
  if (!data || data.length === 0) {
    return (
      <div className="moriarty-chart-empty">
        <p>
          会場別データはまだありません。複数会場のレースが蓄積されると表示されます。
        </p>
      </div>
    );
  }

  const chartData = data.slice(0, 12).map((v) => ({
    name: v.venue_name,
    roi: v.roi,
    bets: v.bets,
  }));

  return (
    <div className="moriarty-chart-wrapper">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-gray-200)" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "var(--color-gray-500)" }}
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: "var(--color-gray-500)" }}
            domain={["auto", "auto"]}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === "roi") return [`${value}%`, "回収率"];
              return [value, name];
            }}
          />
          <ReferenceLine
            y={100}
            stroke="var(--color-gray-400)"
            strokeDasharray="4 4"
          />
          <Bar
            dataKey="roi"
            fill="var(--color-primary-500)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="moriarty-venue-table">
        <table className="moriarty-table">
          <thead>
            <tr>
              <th>会場</th>
              <th>推奨数</th>
              <th>的中</th>
              <th>回収率</th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr key={v.venue_code}>
                <td>{v.venue_name}</td>
                <td>{v.bets}</td>
                <td>{v.hits}</td>
                <td
                  style={{
                    color:
                      v.roi >= 100
                        ? "var(--color-success-text)"
                        : "var(--color-error-text)",
                  }}
                >
                  {v.roi !== null ? `${v.roi}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MoriartyVenueBreakdown;
