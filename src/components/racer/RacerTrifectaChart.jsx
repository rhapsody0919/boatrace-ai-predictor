/**
 * 3着以内のレースの3連単配当の、1走あたり配当の通算の推移（オーナー承認 2026-11-26、side-session-notes の g2-racer/tri）。
 * 基準の線が無いので縦軸は値の幅に合わせ（0から始めない）、単位は軸に1回だけ（visual-designer 2026-11-26）。
 * 万舟の走に○、いちばん大きい走だけに日付（金額は札にしない。wording-editor 2026-11-26）。帯は付けない
 */
import { LeaderLabel } from "./RacerBoatReturnChart";

const W = 340;
const H = 190;
const PAD = { l: 52, r: 74, t: 26, b: 26 };
const STEPS = [100, 200, 250, 500, 1000, 2000, 2500, 5000];
const yen = (v) => Math.round(v).toLocaleString("ja-JP");

function scaleOf(points) {
  const values = points.map((p) => p.value);
  const span = Math.max(...values) - Math.min(...values) || 1;
  const step = STEPS.find((s) => (span * 1.3) / s <= 3.2) ?? 10000;
  const lo = Math.max(0, Math.floor((Math.min(...values) - span * 0.12) / step) * step);
  const hi = Math.ceil((Math.max(...values) + span * 0.12) / step) * step;
  const x = (i) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, points.length - 1);
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { x, y, ticks };
}

/** 配当がいちばん大きかった万舟の走に、空いている側へ引き出し線で日付を置く */
function TopMark({ points, x, y }) {
  let top = -1;
  points.forEach((p, i) => {
    if (p.manshu && (top < 0 || p.manshu > points[top].manshu)) top = i;
  });
  if (top < 0) return null;
  const box = { top: PAD.t, bottom: H - PAD.b, left: PAD.l, right: W - PAD.r };
  return <LeaderLabel px={x(top)} py={y(points[top].value)} label={points[top].date} box={box} />;
}

export default function RacerTrifectaChart({ points }) {
  const { x, y, ticks } = scaleOf(points);
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rti-chart" role="img" aria-label="3連単の1走あたり配当の通算の推移">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border-hairline)" />
          <text x={PAD.l - 4} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
            {yen(v)}
          </text>
        </g>
      ))}
      <text x={PAD.l - 4} y={PAD.t - 12} textAnchor="end" fontSize={10.5} fill="var(--text-secondary)">
        （円）
      </text>
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
        fill="none"
        stroke="var(--brand-accent-primary)"
        strokeWidth={2.2}
      />
      {points.map((p, i) =>
        p.manshu ? (
          <circle key={p.raceId} cx={x(i)} cy={y(p.value)} r={3} fill="var(--surface-card)" stroke="var(--text-primary)" strokeWidth={1.2} />
        ) : null,
      )}
      <TopMark points={points} x={x} y={y} />
      <circle cx={x(last)} cy={y(points[last].value)} r={3.5} fill="var(--brand-accent-primary)" />
      <text x={x(last) + 6} y={y(points[last].value) + 4} fontSize={11} fontWeight={700} fill="var(--brand-accent-primary)">
        {yen(points[last].value)}円
      </text>
      {[...new Set([0, Math.floor(last / 2), last])].map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
          {points[i].date}
        </text>
      ))}
    </svg>
  );
}
