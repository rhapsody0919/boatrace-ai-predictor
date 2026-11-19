import { useTranslation } from "react-i18next";
import {
  RADAR_LINE,
  RADAR_TEXT,
  SCOPE_DASH,
  SCOPE_GRID,
  SCOPE_SUBTEXT,
  SCOPE_TEXT,
} from "./analogyColors";

const k = "aiPredictionTab.analogy.facts";
const BOATS = [1, 2, 3, 4, 5, 6];
// 図の大きさ（承認モック mock-compare-v3 の配置。項目名は外向きに寄せ、頂点に一番上の艇番を置く）
const W = 420;
const R = 88;
const CX = W / 2;
const CY = R * 1.38 + 24;
const H = CY + R * 1.38 + 24;

function angle(i, n) {
  return -Math.PI / 2 + (2 * Math.PI * i) / n;
}
function pt(i, n, f) {
  const a = angle(i, n);
  return [CX + R * f * Math.cos(a), CY + R * f * Math.sin(a)];
}
const fr = (rank) => (7 - rank) / 6;

/** 外周と内側の輪（六角形でなく項目数の多角形） */
function RadarRings({ items }) {
  const n = items.length;
  const ring = (f) => items.map((_, i) => pt(i, n, f).join(",")).join(" ");
  return [1, 2, 3, 4, 5, 6].map((r) => (
    <polygon
      key={r}
      points={ring(fr(r))}
      fill="none"
      stroke={`${SCOPE_GRID}${r === 1 ? 0.45 : 0.18})`}
    />
  ));
}

/** 中心から各項目の頂点への軸線 */
function RadarSpokes({ items }) {
  const n = items.length;
  return items.map((_, i) => {
    const [x, y] = pt(i, n, 1);
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
  });
}

/** 1艇の多角形（2枠は白い縁取り付き）。太くする艇は頂点の点も描く */
function RadarBoatShape({ b, cells, n, on }) {
  // 今日の値が無い項目（当地の記録なし等）は中心に落とさず、その項目を飛ばして結ぶ
  const ps = cells
    .map((c, i) => (c.bucket ? pt(i, n, fr(c.bucket)) : null))
    .filter(Boolean);
  const pts = ps.map((p) => p.join(",")).join(" ");
  const w = on ? 3.2 : 1.6;
  const op = on ? 1 : 0.5;
  return (
    <g data-boat={b}>
      {b === 2 && (
        <polygon
          points={pts}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={op}
          strokeWidth={w + 2.4}
        />
      )}
      <polygon
        points={pts}
        fill={on ? RADAR_LINE[b] : "none"}
        fillOpacity={b <= 2 ? 0.14 : 0.22}
        stroke={RADAR_LINE[b]}
        strokeOpacity={op}
        strokeWidth={w}
      />
      {on &&
        ps.map(([px, py], i) => (
          <circle
            key={i}
            cx={px}
            cy={py}
            r={3.6}
            fill={RADAR_LINE[b]}
            stroke={b === 2 ? "#fff" : "#0d1b2e"}
          />
        ))}
    </g>
  );
}

/** 6艇の多角形。太くする艇を最後に描く（上に重なる）。2艇なら後に押した艇が一番上 */
function RadarBoatShapes({ boats, n, picks }) {
  const order = [...BOATS.filter((b) => !picks.includes(b)), ...picks];
  return order.map((b) => (
    <RadarBoatShape
      key={b}
      b={b}
      cells={boats[b - 1].cells}
      n={n}
      on={picks.includes(b)}
    />
  ));
}

/** 典型の破線（値が全部無ければ描かない） */
function RadarDash({ dash, dashBoat, n }) {
  if (dash.every((v) => v === null)) return null;
  return (
    <polygon
      points={dash
        .map((v, i) => (v === null ? null : pt(i, n, fr(v)).join(",")))
        .filter(Boolean)
        .join(" ")}
      fill="none"
      stroke={
        dashBoat === 2 || dashBoat === 1 ? SCOPE_DASH : RADAR_LINE[dashBoat]
      }
      strokeWidth={1.8}
      strokeDasharray="5 4"
    />
  );
}

/** 項目の頂点に置く、その項目で1位の艇番の丸（同順位は辺に沿って並べる） */
function RadarTopBadges({ tops, i, n }) {
  const [tx, ty] = pt(i, n, 1);
  return tops.map((b, j) => {
    // 同順位の艇番は辺に沿う向きに並べる（横の項目では縦に並び、項目名に重ならない）
    const off = (j - (tops.length - 1) / 2) * 16;
    const a = angle(i, n);
    const ox = tx - Math.sin(a) * off;
    const oy = ty + Math.cos(a) * off;
    return (
      <g key={b} data-top={b}>
        <circle
          cx={ox}
          cy={oy}
          r={7.5}
          fill={RADAR_LINE[b]}
          stroke={b === 2 ? "#fff" : "#0d1b2e"}
          strokeWidth={1.2}
        />
        <text
          x={ox}
          y={oy + 3.6}
          textAnchor="middle"
          fontSize="10"
          fontWeight="800"
          fill={RADAR_TEXT[b]}
        >
          {b}
        </text>
      </g>
    );
  });
}

/** 項目名のボタン（押すと項目の表） */
function RadarAxisButton({ it, i, n, sel, name, sub, onAxis }) {
  const { t } = useTranslation();
  const dx = Math.cos(angle(i, n));
  const mid = Math.abs(dx) < 0.3;
  const [x, y] = pt(i, n, mid ? 1.38 : 1.2);
  const anchor = mid ? "middle" : dx > 0 ? "start" : "end";
  const rx = mid ? x - 50 : dx > 0 ? x : x - 100;
  const act = () => onAxis(it.key);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={sel}
      aria-label={t(`${k}.radar.axisAria`, { item: name })}
      data-af-control="facts_radar_item"
      data-af-toggle=""
      className="af-hep-axis"
      onClick={act}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        act();
      }}
    >
      <rect x={rx} y={y - 15} width={100} height={34} fill="transparent" />
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        fontSize="12.5"
        fontWeight={sel ? 800 : 600}
        fill={sel ? "#ffffff" : SCOPE_TEXT}
        textDecoration={sel ? "underline" : undefined}
      >
        {name} ▼
      </text>
      <text
        x={x}
        y={y + 14}
        textAnchor={anchor}
        fontSize="11.5"
        fill={SCOPE_SUBTEXT}
      >
        {sub}
      </text>
    </g>
  );
}

/** 6艇の線・頂点の艇番・項目名（押すと項目の表） */
function RadarSvg({
  boats,
  items,
  picks,
  dashBoat,
  axisSel,
  onAxis,
  label,
  ariaLabel,
}) {
  const n = items.length;
  const dash = boats[dashBoat - 1].typical;
  return (
    // role="img" の子は読み上げで飾り扱いになり、項目名のボタンが消えるので group にする（ソナーと同じ）
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
      <RadarRings items={items} />
      <RadarSpokes items={items} />
      <RadarBoatShapes boats={boats} n={n} picks={picks} />
      <RadarDash dash={dash} dashBoat={dashBoat} n={n} />
      {items.map((it, i) => {
        const tops = BOATS.filter(
          (b) => boats[b - 1].cells[i].rank?.from === 1,
        );
        const { name, sub } = label(i);
        return (
          <g key={it.key}>
            <RadarTopBadges tops={tops} i={i} n={n} />
            <RadarAxisButton
              it={it}
              i={i}
              n={n}
              sel={axisSel === it.key}
              name={name}
              sub={sub}
              onAxis={onAxis}
            />
          </g>
        );
      })}
    </svg>
  );
}

export { RadarSvg };
