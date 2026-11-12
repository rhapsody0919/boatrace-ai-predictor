/** MeetFormTrendCard の SVG（軸・線と点・下の行）。描画だけを受け持つ */
import { BOAT_LINE_COLORS } from "../../utils/colors";
import { segmentsOf } from "./meetFormTrend";
import { ROW_KEYS } from "./MeetFormTrendScales";

const cellText = (t, metric, run, key) => {
  switch (key) {
    case "day":
      return t("beforeInfo.meetFormDay", {
        day: Number(run.date.slice(8, 10)),
      });
    case "race":
      return t("beforeInfo.meetFormRace", { no: run.raceNo });
    case "frame":
      return run.boatNumber ?? "—";
    case "course":
      return run.course ?? "—";
    case "value":
      return run.values[metric] === null
        ? t("beforeInfo.meetFormNoValue")
        : run.values[metric].toFixed(2);
    default:
      return run.finish ?? "—";
  }
};

/** その日の会場平均の破線。値の無い日は線を切る */
function AvgLine({ points }) {
  const runs = [];
  let cur = [];
  points.forEach((p) => {
    if (p === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(p);
  });
  if (cur.length) runs.push(cur);
  return runs.map((pts) => (
    <polyline
      key={pts[0].join(",")}
      data-venue-avg
      className="mft-avg"
      points={pts.map((p) => p.join(",")).join(" ")}
    />
  ));
}

function Axes({ t, L, W, x, y, ticks, maxRuns }) {
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line
            className="mft-grid"
            x1={L.left}
            x2={W - L.right}
            y1={y(v)}
            y2={y(v)}
          />
          <text
            className="mft-axis"
            x={L.left - 6}
            y={y(v) + 3}
            fontSize={L.font}
            textAnchor="end"
          >
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {Array.from({ length: maxRuns }, (_, i) => (
        <text
          key={i}
          className="mft-axis"
          x={x(i)}
          y={L.chartHeight - 6}
          fontSize={L.font}
          textAnchor="middle"
        >
          {t("beforeInfo.meetFormRunN", { n: i + 1 })}
        </text>
      ))}
    </>
  );
}

function Point({ b, i, v, on, color, L, x, y }) {
  if (v === null) return null;
  if (!on) {
    return <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={color} />;
  }
  return (
    <g key={i} data-boat={b.boat}>
      <circle
        className="mft-point-active"
        cx={x(i)}
        cy={y(v)}
        r={L.finishFont - 2}
        stroke={color}
      />
      <text
        className={b.runs[i].finish === 1 ? "mft-finish is-win" : "mft-finish"}
        x={x(i)}
        y={y(v) + 4}
        fontSize={L.finishFont}
        textAnchor="middle"
      >
        {b.runs[i].finish ?? "—"}
      </text>
    </g>
  );
}

function Series({ b, on, metric, L, x, y }) {
  const vals = b.runs.map((r) => r.values[metric]);
  const color = BOAT_LINE_COLORS[b.boat];
  return (
    <g
      data-boat={b.boat}
      className={on ? "mft-series is-active" : "mft-series"}
    >
      {segmentsOf(vals).map((s) => (
        <line
          key={`${s.from}-${s.to}`}
          x1={x(s.from)}
          y1={y(vals[s.from])}
          x2={x(s.to)}
          y2={y(vals[s.to])}
          stroke={color}
          strokeWidth={on ? 3 : 1.5}
          strokeDasharray={s.gap ? "3 4" : undefined}
        />
      ))}
      {vals.map((v, i) => (
        <Point
          key={i}
          b={b}
          i={i}
          v={v}
          on={on}
          color={color}
          L={L}
          x={x}
          y={y}
        />
      ))}
    </g>
  );
}

function Row({ rowKey, j, t, metric, selected, L, W, x }) {
  const top = L.chartHeight + 8 + j * L.rowHeight;
  const base = top + L.rowHeight - 5;
  return (
    <g className="mft-row" data-boat={selected.boat} data-row={rowKey}>
      <line className="mft-grid" x1={0} x2={W} y1={top} y2={top} />
      <text className="mft-axis" x={0} y={base} fontSize={L.font}>
        {rowKey === "value"
          ? t(`beforeInfo.meetFormRowValue_${metric}`)
          : t(`beforeInfo.meetFormRow_${rowKey}`)}
      </text>
      {selected.runs.map((run, i) => {
        const off =
          rowKey === "course" &&
          run.course !== null &&
          run.course !== run.boatNumber;
        const win = rowKey === "finish" && run.finish === 1;
        return (
          <text
            key={run.raceId}
            className={[
              "mft-cell",
              rowKey === "value" || rowKey === "finish" ? "is-strong" : "",
              off ? "is-course-off" : "",
              win ? "is-win" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            x={x(i)}
            y={base}
            fontSize={rowKey === "finish" ? L.finishFont : L.font}
            textAnchor="middle"
          >
            {cellText(t, metric, run, rowKey)}
          </text>
        );
      })}
    </g>
  );
}

function MeetFormTrendChart({
  t,
  W,
  H,
  L,
  x,
  y,
  ticks,
  maxRuns,
  metric,
  metricLabel,
  selected,
  showAvg,
  avgOf,
  drawOrder,
}) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={t("beforeInfo.meetFormChartLabel", {
        metric: metricLabel(metric),
        boat: selected.boat,
      })}
    >
      <Axes t={t} L={L} W={W} x={x} y={y} ticks={ticks} maxRuns={maxRuns} />
      {showAvg && (
        <AvgLine
          points={selected.runs.map((r, i) => {
            const v = avgOf(r.date);
            return v === null ? null : [x(i), y(v)];
          })}
        />
      )}
      {drawOrder.map((b) => (
        <Series
          key={b.boat}
          b={b}
          on={b.boat === selected.boat}
          metric={metric}
          L={L}
          x={x}
          y={y}
        />
      ))}
      {ROW_KEYS.map((key, j) => (
        <Row
          key={key}
          rowKey={key}
          j={j}
          t={t}
          metric={metric}
          selected={selected}
          L={L}
          W={W}
          x={x}
        />
      ))}
    </svg>
  );
}

export default MeetFormTrendChart;
