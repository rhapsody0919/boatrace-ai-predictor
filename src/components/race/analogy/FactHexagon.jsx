import {
  SCOPE_DASH,
  SCOPE_GRID,
  SCOPE_LINE,
  SCOPE_SUBTEXT,
  SCOPE_TEXT,
} from "./analogyColors";

const CX = 200;
const CY = 182;
const R = 100;

/**
 * 6艇中の順位の多角形（spec A-5。承認版モックの hexRadar と同じ描き方）。外側ほど上位。
 * @param {{axes: {label: string, sub: string}[], series: {values: (number|null)[], boat: number, dash?: boolean}[], ariaLabel: string}} props
 *   values は軸ごとの順位（1〜6、点線は平均の順位で小数）。null の軸は点を描かない
 */
export default function FactHexagon({ axes, series, ariaLabel }) {
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  };
  const rr = (rank) => ((7 - rank) / 6) * R;
  const poly = (rs) => rs.map((r, i) => pt(i, r).join(",")).join(" ");
  return (
    <svg viewBox="-50 0 500 370" role="img" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5, 6].map((k) => (
        <polygon
          key={k}
          points={poly(axes.map(() => rr(k)))}
          fill="none"
          stroke={`${SCOPE_GRID}${k === 1 ? 0.5 : 0.2})`}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke={`${SCOPE_GRID}0.2)`}
          />
        );
      })}
      {series.map((s) => {
        const color = s.dash ? SCOPE_DASH : SCOPE_LINE[s.boat];
        const full = s.values.every((v) => v !== null && v !== undefined);
        return (
          <g key={`${s.boat}-${s.dash ? "d" : "s"}`}>
            {full && (
              <polygon
                points={poly(s.values.map(rr))}
                fill={color}
                fillOpacity={s.dash ? 0.02 : 0.18}
                stroke={color}
                strokeWidth={s.dash ? 1.4 : 2}
                strokeDasharray={s.dash ? "6 4" : undefined}
              />
            )}
            {!s.dash &&
              s.values.map((v, i) => {
                if (v === null || v === undefined) return null;
                const [px, py] = pt(i, rr(v));
                return (
                  <circle
                    key={i}
                    cx={px}
                    cy={py}
                    r={3.2}
                    fill={color}
                    stroke="#0d1b2e"
                  />
                );
              })}
          </g>
        );
      })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, R + 20);
        const dx = x - CX;
        const anchor = dx > 8 ? "start" : dx < -8 ? "end" : "middle";
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={anchor}
            fill={SCOPE_TEXT}
            fontSize="16"
            fontWeight="700"
          >
            <tspan x={x}>{a.label}</tspan>
            <tspan x={x} dy="1.25em" fill={SCOPE_SUBTEXT} fontSize="15">
              {a.sub}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
