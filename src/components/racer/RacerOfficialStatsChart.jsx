/**
 * 選手ページの公式の期別成績の勝率を、期ごとの段で描く（P-12。オーナー 2026-11-27「期ごとの段に1つ」）。
 * レース詳細の基本情報の「勝率の推移（公式の期ごと）」の段（WinRateStepChart）と同じ見え方で、選手1人・全部の期。
 * 期の値はその期の間ずっと同じなので、点を結ぶ折れ線でなく横の段にする。期は1つおきに薄い帯で区切り、
 * 期の札は重ならない間隔で間引く（最新の期は必ず出す）。期の帯に触れる・押すと、その期の勝率・集計期間・走数を出す。
 * 縦の目盛りは整数の等間隔（winRateAxis、BOA-1196）。データは props（chartData・rateAxis）で受け取る（plan.md §13）。
 */
import { useState } from "react";
import { GridLines } from "../race/basic-info/TrendChart";
import { useChartWidth } from "../race/basic-info/useChartWidth.js";

const H = 220;
const PAD = { l: 34, r: 12, t: 14, b: 28 };
// 期の札の最小の間隔（px）。「25後」が約22px
const LABEL_GAP = 34;

// 「2025年後期」→「25後」
const shortLabel = (label) =>
  label.replace(/^\d{2}(\d{2})年(前|後)期$/, "$1$2");

function geometry(chartData, rateAxis, W) {
  const n = chartData.length;
  const cw = (W - PAD.l - PAD.r) / n;
  const [lo, hi] = rateAxis.domain;
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const x0 = (i) => PAD.l + cw * i;
  // 札は k 期おき。最新の期から数えて置き、最新は必ず出す
  const k = Math.max(1, Math.ceil(LABEL_GAP / cw));
  const labeled = (i) => (n - 1 - i) % k === 0;
  return { n, cw, y, x0, labeled };
}

// 横（その期の値）と縦（期の変わり目）。出走0の期（winRate null）で切る
function stepPaths(chartData, x0, cw, y) {
  let flat = "";
  let rise = "";
  chartData.forEach((d, i) => {
    if (d.winRate == null) return;
    const prev = chartData[i - 1];
    if (prev?.winRate != null)
      rise += ` M${x0(i)},${y(prev.winRate)} L${x0(i)},${y(d.winRate)}`;
    flat += ` M${x0(i)},${y(d.winRate)} L${x0(i) + cw},${y(d.winRate)}`;
  });
  return { flat, rise };
}

// 最新の期（出走のある最後の期）の段の上に値の札。上の出走表の勝率と食い違って見えないよう、図の終わりの値を示す
function LatestValue({ chartData, x0, cw, y }) {
  const i = chartData.findLastIndex((d) => d.winRate != null);
  if (i < 0) return null;
  return (
    <text
      x={x0(i) + cw / 2}
      y={y(chartData[i].winRate) - 6}
      className="rps-latest-value"
      textAnchor="middle"
    >
      {chartData[i].winRate.toFixed(2)}
    </text>
  );
}

function PeriodTip({ d, leftPct }) {
  return (
    <div
      className={`rps-tip${leftPct > 55 ? " is-flip" : ""}`}
      style={{ left: `${leftPct}%` }}
    >
      <p className="rps-tip-line">
        {d.label}（集計 {d.range}）
      </p>
      <p className="rps-tip-line">
        {d.winRate == null
          ? "出走なし"
          : `勝率 ${d.winRate.toFixed(2)}・${d.starts}走`}
      </p>
    </div>
  );
}

// 指のなぞりの位置（x）から期を引いて選ぶ。マウスは帯ごとの当たり（rps-hit）で選ぶ
function touchPick(e, W, n, cw, setPick) {
  if (e.pointerType !== "touch") return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - r.left) * W) / r.width;
  const i = Math.min(n - 1, Math.max(0, Math.floor((x - PAD.l) / cw)));
  setPick({ i, pinned: true });
}

export default function RacerOfficialStatsChart({ chartData, rateAxis }) {
  const [ref, W] = useChartWidth();
  const [pick, setPick] = useState(null);
  const { n, cw, y, x0, labeled } = geometry(chartData, rateAxis, W);
  const { flat, rise } = stepPaths(chartData, x0, cw, y);
  const picked = pick === null ? null : chartData[pick.i];
  return (
    <div
      className="racer-official-chart"
      onPointerLeave={() => !pick?.pinned && setPick(null)}
    >
      <svg
        ref={ref}
        className="trc-svg rps-svg"
        // スマホは帯が約16px と狭いので、押したまま指でなぞって期を選べる（visual-designer 11/27）
        onPointerMove={(e) => touchPick(e, W, n, cw, setPick)}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="期ごとの勝率（公式）"
      >
        {chartData.map((d, i) =>
          i % 2 === 0 ? (
            <rect
              key={d.label}
              x={x0(i)}
              y={PAD.t}
              width={cw}
              height={H - PAD.t - PAD.b}
              className="trc-band"
            />
          ) : null,
        )}
        <GridLines
          ticks={rateAxis.ticks}
          y={y}
          x1={PAD.l}
          x2={W - PAD.r}
          label={(g) => String(g)}
        />
        <path className="rps-rise" d={rise} fill="none" />
        <path className="rps-step" d={flat} fill="none" />
        <LatestValue chartData={chartData} x0={x0} cw={cw} y={y} />
        {chartData.map((d, i) =>
          labeled(i) ? (
            <text
              key={d.label}
              x={x0(i) + cw / 2}
              y={H - PAD.b + 16}
              data-label={d.label}
              className={`trc-tick rps-period${i === n - 1 ? " rps-latest" : ""}`}
              textAnchor="middle"
            >
              {shortLabel(d.label)}
            </text>
          ) : null,
        )}
        {picked && (
          <rect
            x={x0(pick.i)}
            y={PAD.t}
            width={cw}
            height={H - PAD.t - PAD.b}
            className="rps-picked"
          />
        )}
        {chartData.map((d, i) => (
          <rect
            key={`h${d.label}`}
            className="rps-hit"
            data-starts={d.winRate == null ? undefined : "1"}
            x={x0(i)}
            y={PAD.t}
            width={cw}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            onPointerEnter={() =>
              !pick?.pinned && setPick({ i, pinned: false })
            }
            onClick={() =>
              setPick((p) =>
                p?.pinned && p.i === i ? null : { i, pinned: true },
              )
            }
          />
        ))}
      </svg>
      {picked && (
        <PeriodTip d={picked} leftPct={((x0(pick.i) + cw / 2) / W) * 100} />
      )}
      <p className="racer-official-note">
        期ごとの勝率（公式）。右端の値は最新の期で、上の「選手調子（全国勝率）」の値は出走表の勝率のため集計の期間が違います。期の帯に触れる・押すと、その期の集計期間と走数が出ます。
      </p>
    </div>
  );
}
