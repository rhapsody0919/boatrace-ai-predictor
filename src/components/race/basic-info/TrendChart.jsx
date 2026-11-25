/**
 * 6艇の推移の線（オーナー 2026-11-24 承認のモック改訂3、docs/reference/design-system.md「表とグラフ」7）。
 * 横は各艇の走の順で右端が最新。選んだ艇だけ太線にし、その艇の日付の目盛りと休みの印を出す。
 * 偶然の幅の帯は付けない（オーナー決定）。軸は0から始めず値の幅に上下の余白を足す。
 * 見た目（trc- のクラス）は TrendChart.css。読み込みは使う側（BasicInfoTrend）が持つ。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";
import { trendGapIndexes } from "../../../pure/racerTrendSeries.js";

const W = 343;
const H = 240;
const PAD = { l: 30, r: 66, t: 18, b: 34 };

const slash = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;

function scaleOf(seriesByBoat, metric) {
  const all = [...seriesByBoat.values()].flat().map((p) => p.value);
  const step = metric === "avgSt" ? 0.01 : 5;
  const lo = Math.floor(Math.min(...all) / step) * step - step;
  const hi = Math.ceil(Math.max(...all) / step) * step + step;
  const n = Math.max(...[...seriesByBoat.values()].map((s) => s.length));
  // 平均ST は小さいほど良いので上に描く
  const y = (v) => {
    const r = (v - lo) / (hi - lo);
    return PAD.t + (H - PAD.t - PAD.b) * (metric === "avgSt" ? r : 1 - r);
  };
  // 右端（最新）をそろえる。点の少ない艇は左を空ける
  const x = (i, len) =>
    PAD.l + ((W - PAD.l - PAD.r) * (n - len + i)) / Math.max(1, n - 1);
  const tickStep = metric === "avgSt" ? 0.02 : 10;
  const ticks = [];
  for (
    let g = Math.ceil(lo / tickStep) * tickStep;
    g <= hi + 1e-9;
    g += tickStep
  )
    ticks.push(g);
  return { x, y, ticks };
}

// 艇番の丸（モーターの推移の線 MotorTrendChart も使う）
export function Badge({ cx, cy, boat, r = 7 }) {
  const c = BOAT_COLORS[boat];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={c.bg} stroke="#9ca3af" />
      <text
        x={cx}
        y={cy + r / 2}
        fontSize={r + 2}
        fontWeight="700"
        textAnchor="middle"
        fill={c.text}
      >
        {boat}
      </text>
    </g>
  );
}

function Line({ points, boat, selected, x, y }) {
  const d = points
    .map((p, i) => `${x(i, points.length)},${y(p.value)}`)
    .join(" ");
  const w = selected ? 3 : 1.4;
  return (
    <g className={`trc-line trc-line-${boat}`}>
      {/* 1号艇の白・2号艇の黒は地に溶けるので縁を付ける */}
      {(boat === 1 || boat === 2) && (
        <polyline
          className="trc-halo"
          points={d}
          fill="none"
          strokeWidth={w + 1.4}
        />
      )}
      <polyline className="trc-stroke" points={d} fill="none" strokeWidth={w} />
    </g>
  );
}

// 右端の値の札。重ならないよう下へずらし、点から引き出し線を付ける（visual-designer 11/24）
function EndLabels({ seriesByBoat, selected, x, y, metric }) {
  const ends = [...seriesByBoat.entries()]
    .map(([boat, s]) => ({ boat, v: s[s.length - 1].value, len: s.length }))
    .sort((a, b) => y(a.v) - y(b.v));
  let last = -99;
  const lx = W - PAD.r + 14;
  return ends.map((e) => {
    const py = y(e.v);
    const yy = Math.max(py, last + 16);
    last = yy;
    const px = x(e.len - 1, e.len);
    return (
      <g key={e.boat}>
        <circle
          cx={px}
          cy={py}
          r={e.boat === selected ? 4.5 : 3}
          fill={BOAT_COLORS[e.boat].bg}
          stroke="#9ca3af"
        />
        <line x1={px + 4} y1={py} x2={lx - 8} y2={yy} className="trc-leader" />
        <Badge cx={lx} cy={yy} boat={e.boat} />
        <text
          x={lx + 10}
          y={yy + 4}
          className="trc-end"
          fontWeight={e.boat === selected ? 700 : 400}
        >
          {metric === "avgSt" ? e.v.toFixed(2) : e.v.toFixed(1)}
        </text>
      </g>
    );
  });
}

// 選んだ艇の日付の目盛り・「最新」・休みの印
function SelectedAxis({ sel, selected, x }) {
  const { t } = useTranslation();
  if (sel.length === 0) return null;
  const marks = [
    0,
    Math.floor(sel.length / 3),
    Math.floor((sel.length * 2) / 3),
  ];
  return (
    <g>
      {marks.map((i) => (
        <text
          key={i}
          x={x(i, sel.length)}
          y={H - 18}
          className="trc-tick"
          textAnchor="middle"
        >
          {slash(sel[i].date)}
        </text>
      ))}
      <text
        x={W - PAD.r}
        y={H - 18}
        className="trc-tick trc-latest"
        textAnchor="middle"
      >
        {t("basicInfo.trend.latest")}
      </text>
      <Badge cx={PAD.l + 6} cy={H - 6} boat={selected} r={6} />
      <text x={PAD.l + 16} y={H - 2} className="trc-axisnote">
        {t("basicInfo.trend.axisNote")}
      </text>
      {trendGapIndexes(sel).map((i) => {
        const gx = (x(i - 1, sel.length) + x(i, sel.length)) / 2;
        return (
          <g key={i}>
            <line
              x1={gx}
              x2={gx}
              y1={PAD.t}
              y2={H - PAD.b}
              className="trc-gap"
            />
            <Badge cx={gx - 40} cy={PAD.t - 8} boat={selected} r={6} />
            <text x={gx - 31} y={PAD.t - 4} className="trc-axisnote">
              {t("basicInfo.trend.gap", { days: sel[i].gapDays })}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export default function TrendChart({ seriesByBoat, metric, selected }) {
  const { t } = useTranslation();
  const { x, y, ticks } = scaleOf(seriesByBoat, metric);
  const sel = seriesByBoat.get(selected) ?? [];
  const order = [...seriesByBoat.keys()].filter((b) => b !== selected);
  if (seriesByBoat.has(selected)) order.push(selected);
  return (
    <svg
      className="trc-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("basicInfo.trend.title", {
        metric: t(`basicInfo.metrics.${metric}`),
      })}
    >
      {ticks.map((g) => (
        <g key={g}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(g)}
            y2={y(g)}
            className="trc-grid"
          />
          <text
            x={PAD.l - 4}
            y={y(g) + 4}
            className="trc-tick"
            textAnchor="end"
          >
            {metric === "avgSt" ? g.toFixed(2) : Math.round(g)}
          </text>
        </g>
      ))}
      {/* 平均ST は「秒（上ほど速い）」と向きも書く（visual-designer 11/24） */}
      <text
        x={metric === "avgSt" ? 2 : PAD.l - 4}
        y={PAD.t - 6}
        className="trc-tick"
        textAnchor={metric === "avgSt" ? "start" : "end"}
      >
        {metric === "avgSt" ? t("basicInfo.trend.unitSec") : "%"}
      </text>
      <SelectedAxis sel={sel} selected={selected} x={x} />
      {order.map((boat) => (
        <Line
          key={boat}
          points={seriesByBoat.get(boat)}
          boat={boat}
          selected={boat === selected}
          x={x}
          y={y}
        />
      ))}
      <EndLabels
        seriesByBoat={seriesByBoat}
        selected={selected}
        x={x}
        y={y}
        metric={metric}
      />
    </svg>
  );
}
