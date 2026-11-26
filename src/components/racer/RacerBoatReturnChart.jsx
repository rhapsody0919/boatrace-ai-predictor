/**
 * 枠番別回収率の推移の線（1つの枠番の単勝・複勝の、各走の時点までの通算）。
 * オーナー承認 2026-11-26（side-session-notes の g2-racer/rr3）。帯は付けない（推移の線のオーナー決定）。
 * 100% の基準の点線があるので縦軸は0から。単位は軸に1回だけ書く。単勝の払戻金が大きい走に○、
 * いちばん大きい走だけに日付を付ける（金額は札にしない。wording-editor 2026-11-26）。
 * 全部の点に走数を出す（オーナー 2026-11-26）: 横軸は「N走目」と日付の2段、図を押すとその点の走数・日付・値を上に出す
 */
import { useState } from "react";

const W = 340;
const H = 224;
const PAD = { l: 48, r: 82, t: 26, b: 42 };
const STEPS = [50, 100, 250, 500, 1000, 2500, 5000];

function scaleOf(points) {
  const max = Math.max(150, ...points.flatMap((p) => [p.win, p.place]));
  const step = STEPS.find((s) => (max * 1.08) / s <= 5) ?? 10000;
  const hi = Math.ceil((max * 1.08) / step) * step;
  const x = (i) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, points.length - 1);
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / hi);
  const ticks = [];
  for (let v = 0; v <= hi; v += step) ticks.push(v);
  return { x, y, ticks };
}

const linePoints = (points, key, x, y) => points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");

/**
 * 点 (px, py) に、描く所（box: top・bottom・left・right）の空いている側へ引き出し線で札を置く。
 * 3連単配当の図（RacerTrifectaChart）と共用する
 */
export function LeaderLabel({ px, py, label, box }) {
  const below = py < (box.top + box.bottom) / 2;
  const ly = below ? Math.min(py + 26, box.bottom - 4) : Math.max(py - 20, box.top + 8);
  const lx = Math.min(Math.max(px, box.left + 18), box.right - 18);
  return (
    <g>
      <line x1={px} y1={py + (below ? 4 : -4)} x2={lx} y2={ly + (below ? -11 : 3)} stroke="var(--text-secondary)" />
      <text x={lx} y={ly} textAnchor="middle" fontSize={10.5} fill="var(--text-primary)">
        {label}
      </text>
    </g>
  );
}

/** いちばん大きい単勝の払戻の走に、空いている側へ引き出し線で日付を置く */
function TopMark({ points, x, y }) {
  let top = -1;
  points.forEach((p, i) => {
    if (p.bigWin && (top < 0 || p.bigWin > points[top].bigWin)) top = i;
  });
  if (top < 0) return null;
  const box = { top: PAD.t, bottom: H - PAD.b, left: PAD.l, right: W - PAD.r };
  return <LeaderLabel px={x(top)} py={y(points[top].win)} label={points[top].date} box={box} />;
}

function EndLabels({ last, x, y, index }) {
  const yw = y(last.win);
  const yp = y(last.place);
  // 2つの札が近いときは上下に離す
  const sep = Math.abs(yw - yp) < 14 ? (yw < yp ? -7 : 7) : 0;
  const lx = x(index) + 6;
  return (
    <g>
      <circle cx={x(index)} cy={yw} r={3.5} fill="var(--brand-accent-primary)" />
      <text x={lx} y={yw + 4 + sep} fontSize={11} fontWeight={700} fill="var(--brand-accent-primary)">
        単勝 {Math.round(last.win).toLocaleString("ja-JP")}%
      </text>
      <circle cx={x(index)} cy={yp} r={3} fill="var(--text-secondary)" />
      <text x={lx} y={yp + 4 - sep} fontSize={11} fill="var(--text-secondary)">
        複勝 {Math.round(last.place).toLocaleString("ja-JP")}%
      </text>
    </g>
  );
}

/** 押した位置にいちばん近い点の添字（viewBox の座標に直して比べる） */
function nearestIndex(event, points, x) {
  const box = event.currentTarget.getBoundingClientRect();
  const vx = ((event.clientX - box.left) / box.width) * W;
  return points.reduce((best, _, i) => (Math.abs(x(i) - vx) < Math.abs(x(best) - vx) ? i : best), 0);
}

const pct = (v) => `${Math.round(v).toLocaleString("ja-JP")}%`;

export default function RacerBoatReturnChart({ points }) {
  const { x, y, ticks } = scaleOf(points);
  const last = points.length - 1;
  const [pick, setPick] = useState(null);
  // 押した位置が点の数を超えたら最新の点にする（key で作り直すが、念のため範囲に収める）
  const at = pick !== null && pick <= last ? pick : last;
  const dateTicks = [...new Set([0, Math.floor(last / 2), last])];
  return (
    <>
      <p className="rbr-readout" aria-live="polite">
        {points[at].n}走目（{points[at].date}）単勝 {pct(points[at].win)}・複勝 {pct(points[at].place)}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="rbr-chart" role="img" aria-label="単勝・複勝の回収率の通算の推移。押すとその走の値を上に出す" onClick={(e) => setPick(nearestIndex(e, points, x))}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border-hairline)" />
          <text x={PAD.l - 4} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
            {v.toLocaleString("ja-JP")}
          </text>
        </g>
      ))}
      <text x={PAD.l - 4} y={PAD.t - 12} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
        （%）
      </text>
      <line x1={PAD.l} x2={W - PAD.r} y1={y(100)} y2={y(100)} stroke="var(--text-secondary)" strokeDasharray="4 3" />
      <polyline points={linePoints(points, "place", x, y)} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} />
      <polyline points={linePoints(points, "win", x, y)} fill="none" stroke="var(--brand-accent-primary)" strokeWidth={2.2} />
      {points.map((p, i) =>
        p.bigWin ? <circle key={p.raceId} cx={x(i)} cy={y(p.win)} r={3} fill="var(--surface-card)" stroke="var(--text-primary)" strokeWidth={1.2} /> : null,
      )}
      <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-secondary)" strokeWidth={0.8} />
      <TopMark points={points} x={x} y={y} />
      <EndLabels last={points[last]} x={x} y={y} index={last} />
      {dateTicks.map((i) => (
        <text key={i} x={x(i)} y={H - 22} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
          <tspan x={x(i)}>{points[i].n}走目</tspan>
          <tspan x={x(i)} dy={14}>{points[i].date}</tspan>
        </text>
      ))}
      </svg>
    </>
  );
}
