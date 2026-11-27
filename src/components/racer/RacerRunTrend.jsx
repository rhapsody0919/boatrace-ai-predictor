/**
 * 選手ページの走ごとの推移（P-31 展示タイム・P-32 ST）を、共通の推移の図（race/basic-info/TrendChart）の
 * 1本の線で描く（オーナー 2026-11-26「既に線がある部品を共通の推移の図へ」）。横軸は走の順で、目盛りは日付。
 * 点を押すと吹き出しにその走の日付・会場・R・艇番→進入・着順・ST と、レース詳細への飛び先が出る。
 * データは props（推移の点の行）で受け取り、自分では取らない（docs/design/indicator-parts/plan.md §13）。
 */
import { trendScaleOf } from "../../pure/trendMetricScale.js";
import TrendChart from "../race/basic-info/TrendChart";
import TrendGainFill from "../race/basic-info/TrendGainFill";
import "../race/basic-info/TrendChart.css";

// 線の鍵。選手ページは今の艇番が無いので札を出さず（尺度の noBadge）、線の色も CSS で文字の色にする
const LINE_KEY = 1;

const METRIC = {
  exhibition: {
    scaleKey: "racerRunExhibition",
    valueOf: (d) => d.avg_exhibition_time,
    flagOf: () => null,
    // 走ごとの比べる相手: 同じレースの他の5艇の展示の平均（racerRaceHistoryRows の othersExhibitionAvg）
    refOf: (d) => d.ref_exhibition ?? null,
  },
  // フライングの走は値の線から外し、上の帯に F
  st: {
    scaleKey: "racerRunSt",
    valueOf: (d) => d.start_timing,
    flagOf: (d) => (d.flying != null ? "F" : null),
    refOf: () => null,
  },
};

const dateLabel = (d) =>
  `${d.slice(2, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 推移の点の行（racerVenueBoatStats の series）を、走の順に横いっぱいに並べた図の点にする
function runPointsOf(rows, metric) {
  const { valueOf, flagOf, refOf } = METRIC[metric];
  const n = rows.length;
  return rows.map((d, i) => ({
    raceId: d.raceKey,
    date: d.run.date,
    value: valueOf(d) ?? null,
    flag: flagOf(d),
    ref: refOf(d),
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

// 右端の札の列に置く比べる線の札の縦の位置。最新の値の札（ey）と、札どうし（2行で約24）が重ならないよう下へずらす
function labelYs(targets, ey) {
  const order = targets.map((t, i) => ({ i, t })).sort((a, b) => a.t - b.t);
  const out = [];
  let prev = -Infinity;
  order.forEach(({ i, t }) => {
    let ly = Math.max(t + 3, prev + 24);
    if (Math.abs(ly - ey) < 14) ly = ey + 18;
    out[i] = ly;
    prev = ly;
  });
  return out;
}

function LineLabel({ x, y, label, className }) {
  return (
    <text className={className}>
      <tspan x={x} y={y}>
        {label.text}
      </tspan>
      {label.sub && (
        <tspan x={x} dy={12}>
          {label.sub}
        </tspan>
      )}
    </text>
  );
}

// 比べる線。lines は横線（ST の期間の平均・今の級×同じコースの全国平均。オーナー 2026-11-27）、ref は走ごとに変わる
// 基準（展示の同じレースの他の5艇の平均）で、それより速い側を薄く塗る（今節の詳細の小さな線 R-45 と同じ見方）。
// 札は右端の札の列に置く（右端の列は狭い 66 なので2行: 名前と値／母数）
function CompareLayer({ sel, x, y, W, pad, lines, refLine }) {
  const x1 = x(0, sel.length);
  const x2 = x(sel.length - 1, sel.length);
  const last = sel.findLast((p) => p.value != null);
  const ey = last ? y(last.value) : -Infinity;
  const refPts = refLine
    ? sel
        .map((p, i) => (p.ref == null ? null : [x(i, sel.length), y(p.ref)]))
        .filter(Boolean)
    : [];
  const lastRef = refPts[refPts.length - 1];
  const labels = [
    ...lines.map((l) => ({ label: l, t: y(l.value), cls: l.cls })),
    ...(lastRef ? [{ label: refLine, t: lastRef[1], cls: "ref" }] : []),
  ];
  const ys = labelYs(
    labels.map((l) => l.t),
    ey,
  );
  return (
    <g className="racer-run-compare">
      {refLine && (
        <TrendGainFill
          sel={sel}
          x={x}
          y={y}
          refOf={(p) => p.ref}
          className="racer-run-gain"
        />
      )}
      {refPts.length > 1 && (
        <polyline
          className="racer-run-line-ref"
          points={refPts.map((q) => q.join(",")).join(" ")}
        />
      )}
      {lines.map((l) => (
        <line
          key={l.cls}
          x1={x1}
          x2={x2}
          y1={y(l.value)}
          y2={y(l.value)}
          className={`racer-run-line-${l.cls}`}
        />
      ))}
      {labels.map((l, k) => (
        <LineLabel
          key={l.cls}
          x={W - pad.r + 8}
          y={ys[k]}
          label={l.label}
          className={`racer-run-label racer-run-label-${l.cls}`}
        />
      ))}
    </g>
  );
}

/**
 * @param {{ rows: Array<object>, metric: "exhibition"|"st", label: string,
 *   lines?: Array<{value: number, text: string, sub?: string, cls: string}>,
 *   refLine?: {text: string, sub?: string} }} props
 *   lines は横線、refLine を渡すと点の ref（走ごとの基準）を破線で引いて速い側を塗る
 */
export default function RacerRunTrend({
  rows,
  metric,
  label,
  lines = [],
  refLine,
}) {
  const points = runPointsOf(rows, metric);
  if (points.length === 0) return null;
  const shown = lines.filter((l) => l.value != null);
  const refs = refLine ? points.map((p) => p.ref).filter((v) => v != null) : [];
  const compare = shown.length > 0 || refs.length > 0;
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
        extraValues={[...shown.map((l) => l.value), ...refs]}
        renderOver={
          compare
            ? ({ x, y, W, pad, sel }) => (
                <CompareLayer
                  sel={sel}
                  x={x}
                  y={y}
                  W={W}
                  pad={pad}
                  lines={shown}
                  refLine={refs.length > 0 ? refLine : null}
                />
              )
            : undefined
        }
      />
    </div>
  );
}
