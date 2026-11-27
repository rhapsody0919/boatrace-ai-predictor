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

export default function RacerRunTrend({ rows, metric, label }) {
  const points = runPointsOf(rows, metric);
  if (points.length === 0) return null;
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
      />
    </div>
  );
}
