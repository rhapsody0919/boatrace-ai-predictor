import { useTranslation } from "react-i18next";
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
import { ST_TREND_ID } from "../../utils/racerPagePath";

// 選手個別ページの成績・調子（RacerPerformanceStats）の推移グラフ3つ。
// 本体の大きさを線の内に収めるため、同じ出力のまま切り出した。

// スマホ幅では推移グラフを直近50走に絞る。200走を幅約250pxに描くと1走あたり約1.2pxで、
// 線と点が帯に潰れて読めなかった（BOA-583 ファン評価2周目）
export const NARROW_CHART_RUNS = 50;
const chartRuns = (rows, isNarrow) =>
  isNarrow ? rows.slice(-NARROW_CHART_RUNS) : rows;
// 横軸はレースごとの値（raceKey＝race_id）で、目盛りには日付だけを出す
const raceTick = (key) =>
  typeof key === "string" && key.length > 10 ? key.slice(2, 10) : key;

// 推移グラフのツールチップの見出し。日付だけだと同じ日の2走を見分けられない（BOA-583）
function useRaceLabelOf() {
  const { t } = useTranslation();
  return (label, payload) => {
    const d = payload?.[0]?.payload;
    if (!d?.venueCode) return label;
    return `${d.date} ${t(`venues.${d.venueCode}`, String(d.venueCode))} ${d.raceNo}R`;
  };
}

function ScopeLabel({ vcActive, vcLabel }) {
  return vcActive ? <span className="racer-vc-scope">— {vcLabel}</span> : null;
}

export function WinRateTrendChart({ chartData }) {
  return (
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
  );
}

export function ExhibitionTrendChart({
  vcData,
  exhibitionChartData,
  isNarrow,
  vcActive,
  vcLabel,
}) {
  const raceLabelOf = useRaceLabelOf();
  const hasVcData = !!vcData;
  return (
    <div className="racer-stat-chart">
      <h3>
        展示タイムの推移（
        {hasVcData ? "2025年12月以降・最大過去2年" : "過去90日"}）
        <ScopeLabel vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      <p className="racer-stat-note">
        1走ごとの展示タイム。下ほど速い。会場によって出方が違うので、会場をまたいだ上下は調子の変化とは限りません
        {isNarrow && `（この画面幅では直近${NARROW_CHART_RUNS}走）`}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={
            hasVcData
              ? chartRuns(
                  vcData.series.filter((d) => d.avg_exhibition_time != null),
                  isNarrow,
                )
              : exhibitionChartData
          }
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={hasVcData ? "raceKey" : "date"}
            tickFormatter={raceTick}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v) => v.toFixed(2)}
            unit="秒"
            width={56}
          />
          <Tooltip
            formatter={(value) => [`${value?.toFixed(2)}秒`, "展示タイム"]}
            labelFormatter={raceLabelOf}
          />
          {/* 階段線（stepAfter）だと1走ごとの値が縦線に埋もれて傾向が読めなかった（BOA-583） */}
          <Line
            type="linear"
            dataKey="avg_exhibition_time"
            name="展示タイム"
            stroke="var(--brand-accent-primary)"
            strokeWidth={1.5}
            dot={{ r: 1.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

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

export function StTrendChart({ vcData, isNarrow, vcActive, vcLabel }) {
  const raceLabelOf = useRaceLabelOf();
  const { top: stAxisTop, ticks: stAxisTicks } = stAxisOf(vcData.series);
  return (
    <div className="racer-stat-chart racer-st-trend" id={ST_TREND_ID}>
      <h3>
        {/* 本番ST（race_start_timings）は2025-12から。展示ST（2026-03〜）を
            使っていた頃の「2026年3月以降」のままだと横軸と食い違う（BOA-576） */}
        STの推移（2025年12月以降・最大過去2年）
        <ScopeLabel vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      <p className="racer-stat-note">
        1走ごとの本番ST。下ほど速い（0がスタートライン）。赤い点はフライングの走で、線には含めていません
        {isNarrow && `（この画面幅では直近${NARROW_CHART_RUNS}走）`}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartRuns(
            vcData.series.filter(
              (d) => d.start_timing != null || d.flying != null,
            ),
            isNarrow,
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
