/**
 * 選手ページの走ごとの推移（P-31 展示タイム・P-32 ST）を、共通の推移の図（race/basic-info/TrendChart）の
 * 1本の線で描く（オーナー 2026-11-26「既に線がある部品を共通の推移の図へ」）。横軸は走の順で、目盛りは日付。
 * 点を押すと吹き出しにその走の日付・会場・R・艇番→進入・着順・ST と、レース詳細への飛び先が出る。
 * データは props（推移の点の行）で受け取り、自分では取らない（docs/design/indicator-parts/plan.md §13）。
 */
import { trendScaleOf } from "../../pure/trendMetricScale.js";
import TrendChart from "../race/basic-info/TrendChart";
import "../race/basic-info/TrendChart.css";

// 線の鍵。選手ページは今の艇番が無いので札を出さず（尺度の noBadge）、線の色も CSS で文字の色にする
const LINE_KEY = 1;

const METRIC = {
  exhibition: {
    scaleKey: "racerRunExhibition",
    valueOf: (d) => d.avg_exhibition_time,
    flagOf: () => null,
  },
  // フライングの走は値の線から外し、上の帯に F
  st: {
    scaleKey: "racerRunSt",
    valueOf: (d) => d.start_timing,
    flagOf: (d) => (d.flying != null ? "F" : null),
  },
};

const dateLabel = (d) =>
  `${d.slice(2, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 推移の点の行（racerVenueBoatStats の series）を、走の順に横いっぱいに並べた図の点にする
function runPointsOf(rows, metric) {
  const { valueOf, flagOf } = METRIC[metric];
  const n = rows.length;
  return rows.map((d, i) => ({
    raceId: d.raceKey,
    date: d.run.date,
    value: valueOf(d) ?? null,
    flag: flagOf(d),
    xr: n > 1 ? i / (n - 1) : 1,
    run: d.run,
  }));
}

// 日付の目盛りは最初・1/3・2/3・最後の4つ（走が多いので間引く）
function xTicksOf(points) {
  const n = points.length;
  const at = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return [...new Set(at)].map((i) => ({
    xr: points[i].xr,
    label: dateLabel(points[i].run.date),
  }));
}

// 期間の平均の横線（オーナー 2026-11-27「期間の平均の横線も足す」）。値は同じ画面のカードの平均ST・平均展示タイム
// （絞り込みの範囲の全走、F を除く）と同じにし、スマホ幅で直近50走だけ描くときも変えない（data-scientist 11/27）。
// 札は右端の札の列に置き、最新の値の札と近いときは上下にずらす
function AvgLine({ sel, x, y, W, pad, avg }) {
  const x1 = x(0, sel.length);
  const x2 = x(sel.length - 1, sel.length);
  const ay = y(avg.value);
  const last = sel.findLast((p) => p.value != null);
  const ey = last ? y(last.value) : -Infinity;
  const ly = Math.abs(ay - ey) < 14 ? ey + (ay >= ey ? 18 : -10) : ay + 3;
  return (
    <g className="racer-run-avg">
      <line x1={x1} x2={x2} y1={ay} y2={ay} className="racer-run-avg-line" />
      {/* 右端の列は狭い（66）ので2行: 平均の値／母数 */}
      <text className="racer-run-avg-label">
        <tspan x={W - pad.r + 8} y={ly}>
          {avg.text}
        </tspan>
        <tspan x={W - pad.r + 8} dy={12}>
          {avg.sub}
        </tspan>
      </text>
    </g>
  );
}

export default function RacerRunTrend({ rows, metric, label, avg }) {
  const points = runPointsOf(rows, metric);
  if (points.length === 0) return null;
  const hasAvg = avg?.value != null;
  return (
    <div className="racer-run-trend">
      <TrendChart
        seriesByBoat={new Map([[LINE_KEY, points]])}
        metric={metric}
        scale={trendScaleOf(METRIC[metric].scaleKey)}
        selected={LINE_KEY}
        label={label}
        lineClass="racer-run-series"
        xTicks={xTicksOf(points)}
        extraValues={hasAvg ? [avg.value] : []}
        renderOver={
          hasAvg
            ? ({ x, y, W, pad, sel }) => (
                <AvgLine sel={sel} x={x} y={y} W={W} pad={pad} avg={avg} />
              )
            : undefined
        }
      />
    </div>
  );
}
