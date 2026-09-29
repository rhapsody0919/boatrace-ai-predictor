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
  yTickDecimals,
  slantXLabels = false,
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        {/* slantXLabels: 横軸が選手名のように長いとき、375pxで重なった目盛りが
            間引かれて一部しか出ない（BOA-557）。斜めにして全部出す */}
        <XAxis
          dataKey="date"
          {...(slantXLabels
            ? { angle: -35, textAnchor: "end", height: 60, interval: 0 }
            : {})}
        />
        <YAxis
          // 回転したラベルを縦方向の中央に置く。既定（start 揃え）だと長いラベルが
          // 375px で上に切れる（「2連率・3連率 (%」。BOA-549）
          label={{
            value: yAxisLabel,
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
          }}
          domain={yAxisDomain}
          // dataMin/dataMaxを使う可変domain（例: "dataMin - 0.1"）はJSの
          // 浮動小数点演算により目盛りが6.989999999999999のような値になることが
          // あるため、表示だけ丸める（domain自体の計算には影響しない）
          // yTickDecimals を渡すと桁数をそろえる（展示タイムで 6.9 と 6.99 が並ばない
          // ように。BOA-549）
          tickFormatter={(value) =>
            yTickDecimals === undefined
              ? Number(value.toFixed(2)).toString()
              : value.toFixed(yTickDecimals)
          }
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
