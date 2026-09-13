/**
 * TrendLineChart - ドリルダウン用の推移折れ線グラフ（BOA-280）
 * MotorConditionChart/ExhibitionTimeTrendChart/RacerFormChart/StPredictabilityChart
 * で完全に同一だったrechartsのJSX骨格を切り出したもの。表示する系列（1本〜2本）は
 * seriesで渡す。
 */
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

function TrendLineChart({
  data,
  series,
  yAxisLabel,
  yAxisDomain,
  tooltipFormatter,
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis
          label={{ value: yAxisLabel, angle: -90, position: "insideLeft" }}
          domain={yAxisDomain}
        />
        <Tooltip formatter={tooltipFormatter} />
        <Legend />
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type={s.type || "monotone"}
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.stroke}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default TrendLineChart;
