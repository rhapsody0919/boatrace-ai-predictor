/**
 * 寄与度のレーダー（BOA-271 FR-1）。軸の数は themes 配列の長さに合わせる（テーマ数を固定しない）。
 * 艇番比較の2系列のときは点に数値を置かない（ラベルが重なるため。数値は比較表で出す）。
 * 系列の色は series[].color（艇の線の色）。無ければブランドの色
 */
const SIZE = 340;
const CENTER = SIZE / 2;
const RADIUS = 100;
const RINGS = [0.25, 0.5, 0.75, 1];

const point = (i, n, r) => {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
};

export default function ContributionRadar({ axes, series, ariaLabel }) {
  const n = axes.length;
  if (n < 3) return null;
  const max = Math.max(0.1, ...series.flatMap((s) => s.values));
  // 目盛りの外周は最大値を10%刻みで切り上げる（小さいシェアのテーマも形が見えるように）
  const scaleMax = Math.ceil(max * 10) / 10;
  const r = (v) => (v / scaleMax) * RADIUS;
  const poly = (values) =>
    values.map((v, i) => point(i, n, r(v)).join(",")).join(" ");
  const showValues = series.length === 1;
  return (
    <svg
      className="af-radar"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={ariaLabel}
    >
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          className="af-radar-ring"
          points={axes
            .map((_, i) => point(i, n, ring * RADIUS).join(","))
            .join(" ")}
        />
      ))}
      {axes.map((axis, i) => {
        const [x, y] = point(i, n, RADIUS);
        return (
          <line
            key={axis.key}
            className="af-radar-axis"
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
          />
        );
      })}
      {/* 外周の目盛り。上の軸ラベルと重ならないよう、外周の内側・軸の右に置く */}
      <text className="af-radar-scale" x={CENTER + 6} y={CENTER - RADIUS + 12}>
        {Math.round(scaleMax * 100)}%
      </text>
      {series.map((s) => (
        <g
          key={s.key}
          className={`af-radar-series af-radar-series-${s.key}`}
          // 艇番比較では艇の線の色（公式色。白・黒・黄は線で見える色に置き換えたもの）を使う
          style={s.color ? { "--af-series-color": s.color } : undefined}
        >
          <polygon className="af-radar-area" points={poly(s.values)} />
          {s.values.map((v, i) => {
            const [x, y] = point(i, n, r(v));
            return (
              <circle
                key={axes[i].key}
                className="af-radar-dot"
                cx={x}
                cy={y}
                r={3}
              />
            );
          })}
        </g>
      ))}
      {axes.map((axis, i) => {
        const [x, y] = point(i, n, RADIUS + 16);
        const dx = x - CENTER;
        const anchor = dx > 8 ? "start" : dx < -8 ? "end" : "middle";
        return (
          <text
            key={axis.key}
            className="af-radar-label"
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            <tspan x={x}>{axis.label}</tspan>
            {showValues && (
              <tspan className="af-radar-label-value" x={x} dy="1.2em">
                {Math.round(series[0].values[i] * 100)}%
              </tspan>
            )}
          </text>
        );
      })}
    </svg>
  );
}
