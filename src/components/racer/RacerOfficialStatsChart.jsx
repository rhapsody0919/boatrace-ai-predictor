import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function RacerOfficialStatsChart({ chartData, rateAxis }) {
  return (
    <div className="racer-official-chart">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 16, left: -8, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          {/* 最後（最新）の期の目盛りは必ず出す。表の先頭の行と折れ線の右端を対応させるため */}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={rateAxis?.domain}
            ticks={rateAxis?.ticks}
            interval={0}
          />
          {/* 期の名前だけだと今の半期と読み違えるので、集計期間を添える（ファン評価 #2051 1周目）。
              375px で右端が切れないよう、系列名は短くする */}
          {/* 位置の移動の動き（transform の transition）は止める。動いている途中は右端が
              画面の外（397〜406px）にあり、収まる位置へ着く前の値が見えてしまう */}
          <Tooltip
            isAnimationActive={false}
            allowEscapeViewBox={{ x: false, y: false }}
            wrapperStyle={{ maxWidth: 200 }}
            contentStyle={{ whiteSpace: "normal" }}
            formatter={(value) => value?.toFixed(2)}
            labelFormatter={(label, payload) =>
              payload?.[0]?.payload?.range
                ? `${label}（集計 ${payload[0].payload.range}）`
                : label
            }
          />
          {/* 線を左から描く動きは止める（isAnimationActive）。描きかけの途中で見ると最後の点が左に寄って見え、
              最新の期と位置が合わない（Orchestrate の Preview の確認 10/28）。ボットの描画も最終の形で読む */}
          <Line
            type="linear"
            dataKey="winRate"
            name="勝率"
            stroke="var(--brand-accent-primary)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="racer-official-note">期ごとの勝率（公式）。</p>
    </div>
  );
}
