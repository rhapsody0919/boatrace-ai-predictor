import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ST_TREND_ID } from "../../utils/racerPagePath";

// 選手個別ページの成績・調子（RacerPerformanceStats）の「STの推移」。
// 本体の大きさを線の内に収めるため、同じ出力のまま切り出した。
// 走の絞り（chartRuns）・目盛り（raceTick）・ツールチップの見出し（raceLabelOf）は
// 展示タイムの推移と共通なので、本体から受け取る。

// STの推移の縦軸。0 から 0.1 刻みで等間隔にする（自動だと 0.15・0.30・0.50 のように
// 上だけ間隔が広くなり、上の方の走の数を読み違えた。ファン評価1周目）
function stAxisOf(series) {
  const stMax = Math.max(0, ...series.map((d) => d.start_timing ?? 0));
  const top = Math.max(0.3, Math.ceil(stMax * 10) / 10);
  const ticks = Array.from(
    { length: Math.round(top * 10) + 1 },
    (_, i) => Math.round(i * 10) / 100,
  );
  return { top, ticks };
}

const stTooltipFormatter = (value, name, item) =>
  name === "F"
    ? [
        item?.payload?.flyingSt != null
          ? `F${Number(item.payload.flyingSt).toFixed(2).replace(/^0/, "")}`
          : "フライング",
        "F",
      ]
    : [`${value?.toFixed(2)}秒`, name];

export default function StTrendChart({
  vcData,
  isNarrow,
  narrowRuns,
  chartRuns,
  raceTick,
  raceLabelOf,
  vcActive,
  vcLabel,
}) {
  const { top: stAxisTop, ticks: stAxisTicks } = stAxisOf(vcData.series);
  return (
    <div className="racer-stat-chart racer-st-trend" id={ST_TREND_ID}>
      <h3>
        {/* 本番ST（race_start_timings）は2025-12から。展示ST（2026-03〜）を
            使っていた頃の「2026年3月以降」のままだと横軸と食い違う（BOA-576） */}
        STの推移（2025年12月以降・最大過去2年）
        {vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
      </h3>
      <p className="racer-stat-note">
        1走ごとの本番ST。下ほど速い（0がスタートライン）。赤い点はフライングの走で、線には含めていません
        {isNarrow && `（この画面幅では直近${narrowRuns}走）`}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartRuns(
            vcData.series.filter(
              (d) => d.start_timing != null || d.flying != null,
            ),
          )}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="raceKey"
            tickFormatter={raceTick}
            tick={{ fontSize: 11 }}
          />
          {/* 0 がスタートライン。下ほど速い（0 に近い）。目盛りは 0.05 刻み */}
          <YAxis
            tick={{ fontSize: 11 }}
            domain={[0, stAxisTop]}
            ticks={stAxisTicks}
            tickFormatter={(v) => v.toFixed(2)}
            unit="秒"
            width={56}
          />
          <Tooltip
            formatter={stTooltipFormatter}
            labelFormatter={raceLabelOf}
          />
          <Line
            type="linear"
            dataKey="start_timing"
            name="ST"
            stroke="var(--brand-accent-secondary)"
            strokeWidth={1.5}
            dot={{ r: 1.5 }}
            connectNulls
          />
          {/* フライングの走は平均・線から外し、0 の位置に赤い点で残す（F 後にスタートを
              控えたかを読めるように。BOA-583） */}
          <Line
            type="linear"
            dataKey="flying"
            name="F"
            stroke="none"
            dot={{ r: 4, fill: "var(--color-error)", stroke: "none" }}
            activeDot={{ r: 5, fill: "var(--color-error)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
