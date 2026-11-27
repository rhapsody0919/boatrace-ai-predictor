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
import RacerRunTrend from "./RacerRunTrend";
import { ST_TREND_ID } from "../../utils/racerPagePath";
import { NARROW_CHART_RUNS, raceTick } from "./racerPerformanceView";

// 選手ページの成績・調子（RacerPerformanceStats）の展示タイム・ST の推移とレース一覧（常時表示、ADR-0063）

// 見出しの期間の始まり（データの最初の走の年月）。始まりの日は直書きしない（過去の走を足すと前へ伸びる）
const sinceOf = (rows) => {
  const d = rows[0]?.run?.date;
  return d
    ? `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月以降・最大過去2年`
    : "";
};

function VcScope({ vcActive, vcLabel }) {
  return vcActive && <span className="racer-vc-scope">— {vcLabel}</span>;
}

/** 展示タイムの推移。履歴があれば1走ごと（共通の推移の図）、無ければ日次の集計 */
export function ExhibitionChart({ view, vcActive, vcLabel }) {
  const { vcData, hasVcData, exhibitionChartData, isNarrow, chartRuns } = view;
  const runs = hasVcData
    ? vcData.series.filter((d) => d.avg_exhibition_time != null)
    : [];
  const show = hasVcData ? runs.length > 0 : exhibitionChartData.length > 0;
  if (!show) return null;
  return (
    <div className="racer-stat-chart">
      <h3>
        展示タイムの推移（{hasVcData ? sinceOf(runs) : "過去90日"}）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      <p className="racer-stat-note">
        {hasVcData
          ? "1走ごとの展示タイム。上ほど速い。会場によって出方が違うので、会場をまたいだ上下は調子の変化とは限りません。点を押すと、その走の値とレース詳細への案内が出ます"
          : "日ごとの展示タイムの平均。下ほど速い。会場によって出方が違うので、会場をまたいだ上下は調子の変化とは限りません"}
        {hasVcData &&
          isNarrow &&
          `（この画面幅では直近${NARROW_CHART_RUNS}走）`}
      </p>
      {hasVcData ? (
        <RacerRunTrend
          rows={chartRuns(runs)}
          metric="exhibition"
          label="展示タイムの推移"
        />
      ) : (
        <DailyExhibitionChart data={exhibitionChartData} view={view} />
      )}
    </div>
  );
}

// 履歴が無いときの日次の平均（過去90日）。走ごとでないので吹き出しの飛び先が無く、今までの図のまま
function DailyExhibitionChart({ data, view }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
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
  );
}

/** STの推移（本番ST、履歴が2走以上のときだけ。共通の推移の図） */
export function StTrendChart({ view, vcActive, vcLabel }) {
  const { vcData, isNarrow, chartRuns } = view;
  if (!view.showStTrend) return null;
  const runs = vcData.series.filter(
    (d) => d.start_timing != null || d.flying != null,
  );
  return (
    <div className="racer-stat-chart racer-st-trend" id={ST_TREND_ID}>
      <h3>
        {/* 見出しの期間はデータの最初の走から（本番ST は 2025-12 から。直書きしない） */}
        STの推移（{sinceOf(runs)}）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      <p className="racer-stat-note">
        1走ごとの本番ST。上ほど速い（0がスタートライン）。フライングの走は線に含めず、図の上の帯に
        F で出します。点を押すと、その走の値とレース詳細への案内が出ます
        {isNarrow && `（この画面幅では直近${NARROW_CHART_RUNS}走）`}
      </p>
      <RacerRunTrend rows={chartRuns(runs)} metric="st" label="STの推移" />
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
