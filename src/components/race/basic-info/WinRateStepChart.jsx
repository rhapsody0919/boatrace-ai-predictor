/**
 * 6艇の勝率の推移を公式の期ごとの段で描く（2026-11-24 オーナー決定「勝率は期ごとの段」、モック3は
 * side-session-notes の mock-winrate-steps）。走ごとの線（TrendChart）と見た目をそろえる:
 * 選んだ艇だけ太線、右に艇の札と値、1・2号艇の縁。段の値を表す横を主役にし、期の変わり目の縦は細く薄く描く。
 * 期は1つおきに薄い帯を敷いて区切る（点線は縦の線と重なって見えないため。visual-designer 11/25）。
 * 横の札は算出期間、その下に選んだ艇の走数。記録の無い期は線を切る。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";
import { stepLabelParts } from "../../../pure/racerWinRateSteps.js";
import { Badge, GridLines } from "./TrendChart";
import { useChartWidth } from "./useChartWidth.js";

const H = 252;
const PAD = { l: 30, r: 66, t: 24, b: 48 };

function scaleOf(stepsByBoat, n, W) {
  const all = [...stepsByBoat.values()]
    .flat()
    .filter(Boolean)
    .map((s) => s.winRate);
  const lo = Math.floor(Math.min(...all) * 2) / 2 - 0.5;
  const hi = Math.ceil(Math.max(...all) * 2) / 2 + 0.25;
  const cw = (W - PAD.l - PAD.r) / n;
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const ticks = [];
  for (let g = Math.ceil(lo); g <= hi; g += 1) ticks.push(g);
  return { x0: (i) => PAD.l + cw * i, cw, y, ticks };
}

// 横（値）と縦（期の変わり目）の道筋。記録の無い期で切る
function pathsOf(steps, x0, cw, y) {
  let flat = "";
  let rise = "";
  steps.forEach((s, i) => {
    if (!s) return;
    const prev = steps[i - 1];
    if (prev) rise += ` M${x0(i)},${y(prev.winRate)} L${x0(i)},${y(s.winRate)}`;
    flat += ` M${x0(i)},${y(s.winRate)} L${x0(i) + cw},${y(s.winRate)}`;
  });
  return { flat, rise };
}

function Steps({ steps, boat, selected, x0, cw, y }) {
  const { flat, rise } = pathsOf(steps, x0, cw, y);
  const w = selected ? 3 : 1.4;
  return (
    <g className={`trc-line trc-line-${boat}`}>
      {(boat === 1 || boat === 2) && (
        <path className="trc-halo" d={flat} fill="none" strokeWidth={w + 1.4} />
      )}
      <path
        className="trc-stroke trc-rise"
        d={rise}
        fill="none"
        strokeWidth={selected ? w : 0.8}
        opacity={selected ? 1 : 0.45}
      />
      <path className="trc-stroke" d={flat} fill="none" strokeWidth={w} />
    </g>
  );
}

// 右端の値の札（TrendChart と同じ、重なれば下へずらして引き出し線）。
// 直前の期に記録が無い艇（休み明け等）も、記録のある最後の期の終わりから札を引く（ファン評価 11/25）
function EndLabels({ stepsByBoat, selected, xEndOf, y, W }) {
  const ends = [...stepsByBoat.entries()]
    .map(([boat, s]) => {
      const i = s.findLastIndex(Boolean);
      return { boat, last: s[i], xEnd: xEndOf(i) };
    })
    .filter((e) => e.last)
    .sort((a, b) => y(a.last.winRate) - y(b.last.winRate));
  let prev = -99;
  const lx = W - PAD.r + 14;
  return ends.map(({ boat, last, xEnd }) => {
    const py = y(last.winRate);
    const yy = Math.max(py, prev + 16);
    prev = yy;
    return (
      <g key={boat}>
        <circle
          cx={xEnd}
          cy={py}
          r={boat === selected ? 4.5 : 3}
          fill={BOAT_COLORS[boat].bg}
          stroke="#9ca3af"
        />
        <line
          x1={xEnd + 4}
          y1={py}
          x2={lx - 8}
          y2={yy}
          className="trc-leader"
        />
        <Badge cx={lx} cy={yy} boat={boat} />
        <text
          x={lx + 10}
          y={yy + 4}
          className="trc-end"
          fontWeight={boat === selected ? 700 : 400}
        >
          {last.winRate.toFixed(2)}
        </text>
      </g>
    );
  });
}

// 期の札（算出期間の2行）と、選んだ艇の走数の行
function PeriodAxis({ periods, sel, selected, x0, cw }) {
  const { t } = useTranslation();
  const base = H - PAD.b;
  return (
    <g>
      {periods.map((p, i) => {
        const { from, to, month } = stepLabelParts(p);
        const cx = x0(i) + cw / 2;
        const cls = `trc-tick${i === periods.length - 1 ? " trc-latest" : ""}`;
        const s = sel[i];
        return (
          <g key={p.calcFrom}>
            <text x={cx} y={base + 14} className={cls} textAnchor="middle">
              {t("basicInfo.trend.stepFrom", { from })}
            </text>
            <text x={cx} y={base + 27} className={cls} textAnchor="middle">
              {month === null ? to : t("basicInfo.trend.stepMonth", { month })}
            </text>
            <text x={cx} y={base + 42} className={cls} textAnchor="middle">
              {s
                ? t("basicInfo.trend.starts", { n: s.starts ?? "—" })
                : t("basicInfo.trend.noRecord")}
            </text>
          </g>
        );
      })}
      <Badge cx={8} cy={base + 38} boat={selected} r={6} />
      <text x={15} y={base + 42} className="trc-axisnote">
        {t("basicInfo.trend.startsLabel")}
      </text>
    </g>
  );
}

export default function WinRateStepChart({ stepsByBoat, periods, selected }) {
  const { t } = useTranslation();
  const [ref, W] = useChartWidth();
  const n = periods.length;
  const { x0, cw, y, ticks } = scaleOf(stepsByBoat, n, W);
  const order = [...stepsByBoat.keys()].filter((b) => b !== selected);
  if (stepsByBoat.has(selected)) order.push(selected);
  return (
    <svg
      ref={ref}
      className="trc-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("basicInfo.trend.winRateTitle")}
    >
      {periods.map((p, i) =>
        i % 2 === 0 ? (
          <rect
            key={p.calcFrom}
            x={x0(i)}
            y={PAD.t}
            width={cw}
            height={H - PAD.t - PAD.b}
            className="trc-band"
          />
        ) : null,
      )}
      <GridLines
        ticks={ticks}
        y={y}
        x1={PAD.l}
        x2={W - PAD.r}
        label={(g) => g.toFixed(1)}
      />
      <text x={PAD.l - 4} y={PAD.t - 6} className="trc-tick" textAnchor="end">
        {t("basicInfo.metrics.winRate")}
      </text>
      <PeriodAxis
        periods={periods}
        sel={stepsByBoat.get(selected) ?? []}
        selected={selected}
        x0={x0}
        cw={cw}
      />
      {order.map((boat) => (
        <Steps
          key={boat}
          steps={stepsByBoat.get(boat)}
          boat={boat}
          selected={boat === selected}
          x0={x0}
          cw={cw}
          y={y}
        />
      ))}
      <EndLabels
        stepsByBoat={stepsByBoat}
        selected={selected}
        xEndOf={(i) => x0(i + 1)}
        y={y}
        W={W}
      />
    </svg>
  );
}
