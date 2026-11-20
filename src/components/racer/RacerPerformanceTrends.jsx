import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import RecentRunsTable from "../race/RecentRunsTable";
import { ST_TREND_ID } from "../../utils/racerPagePath";
import { NARROW_CHART_RUNS, raceTick } from "./racerPerformanceView";

// 選手ページの成績・調子（RacerPerformanceStats）の展示タイム・ST の推移とレース一覧（常時表示、ADR-0063）

function VcScope({ vcActive, vcLabel }) {
  return vcActive && <span className="racer-vc-scope">— {vcLabel}</span>;
}

/** 展示タイムの推移。履歴があれば1走ごと、無ければ日次の集計 */
export function ExhibitionChart({ view, vcActive, vcLabel }) {
  const { vcData, hasVcData, exhibitionChartData, isNarrow, chartRuns } = view;
  const show = hasVcData
    ? vcData.series.some((d) => d.avg_exhibition_time != null)
    : exhibitionChartData.length > 0;
  if (!show) return null;
  return (
    <div className="racer-stat-chart">
      <h3>
        展示タイムの推移（
        {hasVcData ? "2025年12月以降・最大過去2年" : "過去90日"}）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
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
            labelFormatter={view.raceLabelOf}
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

const stTooltip = (value, name, item) =>
  name === "F"
    ? [
        item?.payload?.flyingSt != null
          ? `F${Number(item.payload.flyingSt).toFixed(2).replace(/^0/, "")}`
          : "フライング",
        "F",
      ]
    : [`${value?.toFixed(2)}秒`, name];

/** STの推移（本番ST、履歴が2走以上のときだけ） */
export function StTrendChart({ view, vcActive, vcLabel }) {
  const { vcData, isNarrow, chartRuns, stAxisTop, stAxisTicks } = view;
  if (!view.showStTrend) return null;
  return (
    <div className="racer-stat-chart racer-st-trend" id={ST_TREND_ID}>
      <h3>
        {/* 本番ST（race_start_timings）は2025-12から。展示ST（2026-03〜）を
            使っていた頃の「2026年3月以降」のままだと横軸と食い違う（BOA-576） */}
        STの推移（2025年12月以降・最大過去2年）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
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
          <Tooltip formatter={stTooltip} labelFormatter={view.raceLabelOf} />
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

/** レース一覧（10走ずつのページ） */
export function RaceList({ vc, view, vcLabel }) {
  const { vcData, vcRaceTotalPages, vcRacePageRows } = view;
  const { vcRacePage, setVcRacePage } = vc;
  if (!(view.hasVcData && vcData.n > 0)) return null;
  return (
    <div className="racer-vc-race-list">
      <h3>
        レース一覧
        <VcScope vcActive={vc.vcActive} vcLabel={vcLabel} />
      </h3>
      <RecentRunsTable rows={vcRacePageRows} />
      {vcRaceTotalPages > 1 && (
        <div className="racer-vc-pager">
          <button
            type="button"
            disabled={vcRacePage <= 1}
            onClick={() => setVcRacePage((p) => p - 1)}
          >
            ← 前へ
          </button>
          <span>
            {vcRacePage} / {vcRaceTotalPages}ページ（全
            {vcData.matchedRaces.length}走）
          </span>
          <button
            type="button"
            disabled={vcRacePage >= vcRaceTotalPages}
            onClick={() => setVcRacePage((p) => p + 1)}
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  );
}
