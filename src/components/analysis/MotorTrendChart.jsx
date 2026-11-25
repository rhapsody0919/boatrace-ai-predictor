/**
 * 6基のモーターの推移の線（今の世代＝入れ替えの後だけ。オーナー 2026-11-25 承認のモック改訂2）。
 * 横は入れ替えの日から今日までの日付で、6基とも同じ。率は節ごとの公式の点、展示タイムは直近30走の平均。
 * 描き始めの走数に届く前の区間は地を塗り「描かない」と書く。選んだ艇だけ太線にし、率なら節の点も打つ。
 * 線の色・目盛りの見た目は TrendChart.css（選手の推移の線）の trc- を使い、ここに固有の物は MotorTrendChart.css。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { Badge } from "../race/basic-info/TrendChart.jsx";
import "../race/basic-info/TrendChart.css";
import "./MotorTrendChart.css";

const W = 343;
const H = 250;
const PAD = { l: 34, r: 76, t: 24, b: 36 };
const dayOf = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const slash = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;
const isEx = (metric) => metric === "exhibition";
const fmt = (metric, v) => (isEx(metric) ? v.toFixed(2) : v.toFixed(1));

function scaleOf(seriesByBoat, metric, generationStart, today) {
  const all = [...seriesByBoat.values()].flat().map((p) => p.value);
  const step = isEx(metric) ? 0.02 : 5;
  const lo = Math.floor(Math.min(...all) / step) * step - step;
  const hi = Math.ceil(Math.max(...all) / step) * step + step;
  const d0 = dayOf(generationStart);
  const span = Math.max(1, dayOf(today) - d0);
  const x = (date) => PAD.l + ((W - PAD.l - PAD.r) * (dayOf(date) - d0)) / span;
  // 展示タイムは小さいほど速いので上に描く
  const y = (v) => {
    const r = (v - lo) / (hi - lo);
    return PAD.t + (H - PAD.t - PAD.b) * (isEx(metric) ? r : 1 - r);
  };
  const tickStep = isEx(metric) ? 0.04 : 10;
  const ticks = [];
  for (let g = Math.ceil(lo / tickStep) * tickStep; g <= hi + 1e-9; g += tickStep) ticks.push(g);
  return { x, y, ticks };
}

function Line({ points, boat, selected, showDots, x, y }) {
  const d = points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ");
  const w = selected ? 3 : 1.4;
  const end = points[points.length - 1];
  return (
    <g className={`trc-line trc-line-${boat}`}>
      {/* 1号艇の白・2号艇の黒・5号艇の黄は地に溶けるので縁を付ける */}
      {[1, 2, 5].includes(boat) && (
        <polyline className="trc-halo" points={d} fill="none" strokeWidth={w + 1.4} />
      )}
      <polyline className="trc-stroke" points={d} fill="none" strokeWidth={w} />
      {showDots &&
        points
          .filter((p) => !p.extended)
          .map((p) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={2.6} fill={BOAT_COLORS[boat].bg} stroke="#9ca3af" strokeWidth={0.6} />
          ))}
      <circle cx={x(end.date)} cy={y(end.value)} r={selected ? 4.5 : 3} fill={BOAT_COLORS[boat].bg} stroke="#9ca3af" />
    </g>
  );
}

// 右端の値の札。上下へ逃がして図の中に収め、点から折れた引き出し線を付ける（visual-designer 11/24）
function EndLabels({ seriesByBoat, selected, y, metric }) {
  const gap = 16;
  const items = [...seriesByBoat.entries()]
    .map(([boat, s]) => ({ boat, v: s[s.length - 1].value }))
    .map((e) => ({ ...e, py: y(e.v), k: y(Number(fmt(metric, e.v))) }))
    .sort((a, b) => a.k - b.k || a.boat - b.boat);
  items.forEach((e, i) => (e.yy = Math.max(e.py, i ? items[i - 1].yy + gap : PAD.t)));
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const limit = i === items.length - 1 ? H - PAD.b : items[i + 1].yy - gap;
    items[i].yy = Math.min(items[i].yy, limit);
  }
  const lx = W - PAD.r + 24;
  return items.map((e) => (
    <g key={e.boat}>
      <polyline points={`${W - PAD.r + 4},${e.py} ${W - PAD.r + 12},${e.py} ${lx - 8},${e.yy}`} fill="none" className="mtc-leader" />
      <Badge cx={lx} cy={e.yy} boat={e.boat} />
      <text x={lx + 10} y={e.yy + 4} className="trc-end" fontWeight={e.boat === selected ? 700 : 400}>
        {fmt(metric, e.v)}
      </text>
    </g>
  ));
}

function Axis({ generationStart, today, firstDate, minRuns, metric, x }) {
  const { t } = useTranslation();
  const mid = new Date(((dayOf(generationStart) + dayOf(today)) / 2) * 86400000).toISOString().slice(0, 10);
  return (
    <g>
      {firstDate > generationStart && (
        <rect x={PAD.l + 1} y={PAD.t} width={Math.max(0, x(firstDate) - PAD.l - 1)} height={H - PAD.b - PAD.t} className="mtc-before" />
      )}
      <text x={PAD.l + 18} y={PAD.t - 8} className="trc-tick">
        {t("analysis.motor.genTrend.notYet", { n: minRuns })}
      </text>
      {isEx(metric) && (
        <text x={W - PAD.r} y={PAD.t - 8} className="trc-tick" textAnchor="end">
          {t("analysis.motor.genTrend.faster")}
        </text>
      )}
      <text x={x(generationStart)} y={H - 20} className="trc-tick trc-latest">
        {t("analysis.motor.genTrend.swapped", { date: slash(generationStart) })}
      </text>
      <text x={x(mid)} y={H - 20} className="trc-tick" textAnchor="middle">
        {slash(mid)}
      </text>
      <text x={x(today)} y={H - 20} className="trc-tick trc-latest" textAnchor="middle">
        {t("analysis.motor.genTrend.today")}
      </text>
      <text x={PAD.l} y={H - 4} className="trc-axisnote">
        {t("analysis.motor.genTrend.axisNote")}
      </text>
    </g>
  );
}

/**
 * @param {{seriesByBoat: Map<number, Array<{date:string,value:number,extended?:boolean}>>,
 *   metric: "top2Rate"|"top3Rate"|"exhibition", selected: number, generationStart: string, today: string, minRuns: number}} props
 *   seriesByBoat は点のある艇だけ（空の系列を入れない）。1艇も無いときは使う側が空の状態を出す
 */
export default function MotorTrendChart({ seriesByBoat, metric, selected, generationStart, today, minRuns }) {
  const { t } = useTranslation();
  const { x, y, ticks } = scaleOf(seriesByBoat, metric, generationStart, today);
  const firstDate = [...seriesByBoat.values()].map((s) => s[0].date).sort()[0];
  const order = [...seriesByBoat.keys()].filter((b) => b !== selected);
  if (seriesByBoat.has(selected)) order.push(selected);
  return (
    <svg className="trc-svg mtc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t(`analysis.motor.genTrend.title.${metric}`)}>
      {ticks.map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="trc-grid" />
          <text x={PAD.l - 4} y={y(g) + 4} className="trc-tick" textAnchor="end">
            {isEx(metric) ? g.toFixed(2) : Math.round(g)}
          </text>
        </g>
      ))}
      <text x={PAD.l - 4} y={PAD.t - 8} className="trc-tick" textAnchor="end">
        {isEx(metric) ? t("analysis.motor.genTrend.unitSec") : "%"}
      </text>
      <Axis generationStart={generationStart} today={today} firstDate={firstDate} minRuns={minRuns} metric={metric} x={x} />
      {order.map((boat) => (
        <Line key={boat} points={seriesByBoat.get(boat)} boat={boat} selected={boat === selected} showDots={!isEx(metric) && boat === selected} x={x} y={y} />
      ))}
      <EndLabels seriesByBoat={seriesByBoat} selected={selected} y={y} metric={metric} />
    </svg>
  );
}
