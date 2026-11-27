/**
 * 選手ページ「今節のモーター状況」の、この選手がこのモーターで走った走ごとの展示タイムの図（時系列の振り分け P-16・F-051）。
 * モーターの推移（レーン B、MotorTrendChart）と同じ見せ方にそろえる: 値はそのレースの展示タイムの平均との差
 * （オーナー 2026-11-25「B 差で作る」。負が速いので上に描く）、目盛りと線は trc- の見た目、点を押すと吹き出し。
 * 部品交換・プロペラ交換のあった走には、点の上に印を付ける（exhibition_data の propeller_change・parts_changed）。
 * データは props で受け取る（取得は入口の選手ページ、plan.md §13）
 */
import { useRef } from "react";
import { GridLines } from "../race/basic-info/TrendChart.jsx";
import { useChartWidth } from "../race/basic-info/useChartWidth.js";
import { useChartPick } from "../race/basic-info/useChartPick.js";
// 目盛り・線の地・吹き出しの見た目（trc-）。選手ページは推移の図をほかに読まないので、ここで読む
import "../race/basic-info/TrendChart.css";

const H = 200;
const PAD = { l: 44, r: 18, t: 34, b: 34 };
const STEP = 0.02;

/** 差の字。負は平均より速い（−0.03）。丸めて0は ±0.00 */
const signedDiff = (v) => {
  const s = Math.abs(v).toFixed(2);
  return s === "0.00" ? "±0.00" : `${v < 0 ? "−" : "+"}${s}`;
};
const md = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;
const runLabel = (r) => `${md(r.date)} ${r.raceNo}R`;
const changeText = (r) =>
  [
    r.parts?.length ? `${r.parts.join("・")}交換` : null,
    r.propellerChanged ? "プロペラ交換" : null,
  ]
    .filter(Boolean)
    .join("・");

function scaleOf(runs, W) {
  const vals = runs
    .map((r) => r.exhibitionDiff)
    .filter((v) => typeof v === "number");
  const lo = Math.floor(Math.min(0, ...vals) / STEP) * STEP - STEP;
  const hi = Math.ceil(Math.max(0, ...vals) / STEP) * STEP + STEP;
  const x = (i) =>
    PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, runs.length - 1);
  // 差は小さいほど速いので上に描く
  const y = (v) => PAD.t + ((H - PAD.t - PAD.b) * (v - lo)) / (hi - lo);
  const ticks = [];
  for (
    let g = Math.ceil(lo / (STEP * 2)) * STEP * 2;
    g <= hi + 1e-9;
    g += STEP * 2
  )
    ticks.push(Number(g.toFixed(2)));
  return { x, y, ticks };
}

function Marks({ runs, x }) {
  return runs.map((r, i) =>
    r.parts?.length || r.propellerChanged ? (
      <g key={r.raceId} className="rmmc-change">
        <line
          x1={x(i)}
          x2={x(i)}
          y1={PAD.t - 6}
          y2={H - PAD.b}
          className="rmmc-change-line"
        />
        <text
          x={x(i)}
          y={PAD.t - 10}
          textAnchor="middle"
          className="rmmc-change-text"
        >
          {r.propellerChanged && !r.parts?.length ? "ペラ" : "部品"}
        </text>
      </g>
    ) : null,
  );
}

function Tip({ run, leftPct, pinned, onClose }) {
  const change = changeText(run);
  return (
    <div
      className={`trc-tip${pinned ? " is-pinned" : ""}${leftPct > 55 ? " is-flip" : ""}`}
      style={{ left: `${leftPct}%` }}
    >
      {pinned && (
        <button
          type="button"
          className="trc-tip-close"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
      <p className="trc-tip-line">{runLabel(run)}</p>
      <p className="trc-tip-line trc-tip-value">
        {`展示 ${run.exhibitionTime.toFixed(2)}秒（レースの平均との差 ${signedDiff(run.exhibitionDiff)}）`}
      </p>
      {change && <p className="trc-tip-line">{change}</p>}
    </div>
  );
}

/**
 * @param {{runs: Array<{raceId:string,date:string,raceNo:number,exhibitionTime:number,exhibitionDiff:number|null,parts:string[]|null,propellerChanged:boolean}>}} props
 *   runs は古い順。差の無い走（6艇の展示がそろわない）は点を打たず、横の位置だけ取る
 */
export default function RacerMotorMeetChart({ runs }) {
  const [ref, W] = useChartWidth();
  const { x, y, ticks } = scaleOf(runs, W);
  const boxRef = useRef(null);
  const valued = runs
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => typeof r.exhibitionDiff === "number");
  const { pick, close, handlers } = useChartPick({
    xs: valued.map(({ i }) => x(i)),
    key: runs.length,
    W,
    boxRef,
  });
  const picked = pick ? valued[pick.i] : null;
  const last = runs.length - 1;
  return (
    <div className="trc-chartbox" ref={boxRef}>
      <svg
        ref={ref}
        className="trc-svg rmmc-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="この選手がこのモーターで走った走ごとの展示タイム（レースの平均との差）"
      >
        <GridLines
          ticks={ticks}
          y={y}
          x1={PAD.l}
          x2={W - PAD.r}
          label={(g) => (g === 0 ? "平均" : signedDiff(g))}
        />
        <text
          x={PAD.l - 4}
          y={PAD.t - 22}
          className="trc-tick"
          textAnchor="end"
        >
          秒差
        </text>
        <text
          x={W - PAD.r}
          y={PAD.t - 22}
          className="trc-tick"
          textAnchor="end"
        >
          上ほど速い
        </text>
        <Marks runs={runs} x={x} />
        <polyline
          points={valued
            .map(({ r, i }) => `${x(i)},${y(r.exhibitionDiff)}`)
            .join(" ")}
          fill="none"
          className="rmmc-line"
        />
        {valued.map(({ r, i }) => (
          <circle
            key={r.raceId}
            cx={x(i)}
            cy={y(r.exhibitionDiff)}
            r={3.2}
            className="rmmc-dot"
          />
        ))}
        {[0, Math.floor(last / 2), last]
          .filter((i, k, a) => a.indexOf(i) === k)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 16}
              textAnchor="middle"
              className="trc-tick"
            >
              {runLabel(runs[i])}
            </text>
          ))}
        {picked && (
          <g className="trc-pick">
            <line
              x1={x(picked.i)}
              x2={x(picked.i)}
              y1={PAD.t}
              y2={H - PAD.b}
              className="trc-pick-line"
            />
            <circle
              cx={x(picked.i)}
              cy={y(picked.r.exhibitionDiff)}
              r={6}
              className="trc-pick-ring"
            />
          </g>
        )}
        <rect
          className="trc-hit"
          x={PAD.l}
          y={PAD.t}
          width={W - PAD.l - PAD.r}
          height={H - PAD.t - PAD.b}
          fill="transparent"
          {...handlers}
        />
      </svg>
      {picked && (
        <Tip
          run={picked.r}
          leftPct={(x(picked.i) / W) * 100}
          pinned={pick.pinned}
          onClose={close}
        />
      )}
    </div>
  );
}
