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

// 見出しの期間。データの最初の走の年月から作り、始まりの日は直書きしない（過去の走を足すと前へ伸びる）。
// スマホ幅は図を直近 N 走に絞るので、見出しもそう書く（図の中身と食い違わない。visual-designer 11/27）
const sinceOf = (rows, isNarrow) => {
  if (isNarrow && rows.length > NARROW_CHART_RUNS)
    return `直近${NARROW_CHART_RUNS}走`;
  const d = rows[0]?.run?.date;
  return d
    ? `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月以降・最大過去2年`
    : "";
};

// 期間の平均の横線（点線）の札。カードと同じ桁（ST は3桁・展示は2桁）と母数（全N走）。絞り込みのときはその名前も
const avgOf = (value, digits, n, vcActive, vcLabel) =>
  value == null
    ? null
    : {
        cls: "avg",
        value,
        text: `平均 ${value.toFixed(digits)}`,
        sub: `${vcActive ? `${vcLabel}・` : ""}全${n}走`,
      };

// 今の級×同じ進入コースの全国平均（破線）の札（オーナー 2026-11-27、ファン4人の議論の推奨）
const baseOf = (base, grade) =>
  base == null
    ? null
    : {
        cls: "base",
        value: base.value,
        text: `${grade} ${base.value.toFixed(3)}`,
        sub: "同コース",
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
        展示タイムの推移（{hasVcData ? sinceOf(runs, isNarrow) : "過去90日"}）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      {/* 図の前は1行だけにし、断りは図の下へ（375px で図が下へ押された。visual-designer 11/27） */}
      <p className="racer-stat-note">
        {hasVcData
          ? "1走ごとの展示タイム。上ほど速い。"
          : "日ごとの展示タイムの平均。下ほど速い。"}
      </p>
      {hasVcData ? (
        <RacerRunTrend
          rows={chartRuns(runs)}
          metric="exhibition"
          label="展示タイムの推移"
          refLine={{ text: "他5艇平均", sub: "同じレース" }}
        />
      ) : (
        <DailyExhibitionChart data={exhibitionChartData} view={view} />
      )}
      <p className="racer-stat-note">
        {hasVcData
          ? "破線は同じレースの他の5艇の平均で、それより速い走を薄く塗っています。内の艇番ほど速く出ます（1号艇で約0.02秒）。点を押すとそのレースへ"
          : "会場によって出方が違うので、会場をまたいだ上下は調子の変化とは限りません"}
      </p>
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
export function StTrendChart({ view, vcActive, vcLabel, stBase, grade }) {
  const { vcData, isNarrow, chartRuns } = view;
  if (!view.showStTrend) return null;
  const runs = vcData.series.filter(
    (d) => d.start_timing != null || d.flying != null,
  );
  return (
    <div className="racer-stat-chart racer-st-trend" id={ST_TREND_ID}>
      <h3>
        {/* 見出しの期間はデータの最初の走から（本番ST は 2025-12 から。直書きしない） */}
        STの推移（{sinceOf(runs, isNarrow)}）
        <VcScope vcActive={vcActive} vcLabel={vcLabel} />
      </h3>
      <p className="racer-stat-note">
        1走ごとの本番ST。上ほど速い（0がスタートライン）。
      </p>
      <RacerRunTrend
        rows={chartRuns(runs)}
        metric="st"
        label="STの推移"
        lines={[
          avgOf(vcData.avgSt, 3, vcData.stN, vcActive, vcLabel),
          baseOf(stBase, grade),
        ].filter(Boolean)}
      />
      <p className="racer-stat-note">
        点線はこの条件の全走の平均、破線は今の級（{grade ?? "—"}
        ）で同じ進入コースの全国平均（どちらもフライングを除く）。1走ずつでなく点の集まりの位置で比べます。フライングは図の上の帯に
        F。点を押すとそのレースへ
      </p>
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
