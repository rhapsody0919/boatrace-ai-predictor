/**
 * 龍神ソナーの図（類似度の円・着順の流れのサンキー図・よく出た3連単）の配置（純粋関数）。
 * 円の半径・点の角度は画面（src/components/race/analogy/SimilarSonar.jsx）と同じ式。
 */
import { BODY_Y, LEFT, RIGHT } from "./pageLayout.js";

// 類似度の円
export const SONAR = { cx: 500, cy: BODY_Y + 300, R: 290 };
const ang = (b) => -90 + (b - 1) * 60;
/** 似ている順の番目 → 中心からの距離（100件未満は等間隔、それ以上は対数。画面の rOf と同じ） */
export function sonarR(rank, n) {
  const R = SONAR.R;
  return n < 100
    ? 18 + ((R - 24) * Math.max(1, rank)) / Math.max(n, 1)
    : 18 + ((R - 24) * Math.log10(Math.max(1, rank))) / Math.log10(n);
}
/** 点の位置（1着の艇の向きの扇に、番目の距離で置く） */
export function sonarPoint(winner, rank, n) {
  const frac = ((rank * 0.6180339) % 1) * 0.84 + 0.08;
  const a = ((ang(winner) - 30 + 60 * frac) * Math.PI) / 180;
  const r = sonarR(rank, n);
  return { x: SONAR.cx + r * Math.cos(a), y: SONAR.cy + r * Math.sin(a) };
}
/** 円の下の、艇ごとの1着の件数の札 */
export const SONAR_CHIP = {
  y: SONAR.cy + SONAR.R + 30,
  w: 135,
  h: 84,
  step: 153,
};
export const sonarChipBox = (b) => ({
  x: LEFT - 20 + (b - 1) * SONAR_CHIP.step,
  y: SONAR_CHIP.y,
  w: SONAR_CHIP.w,
  h: SONAR_CHIP.h,
});

// 着順の流れ（1着・2着・3着の3列）
export const SANKEY = {
  top: BODY_Y + 60,
  height: 590,
  nodeW: 56,
  gap: 10,
  cols: [LEFT + 70, LEFT + 380, LEFT + 690],
};

/**
 * サンキー図の配置。links は flowLinks の [p, 前の艇, 後の艇, 件数]、node の高さは件数に比例（列ごとの合計＝n）
 * @returns {{nodes: {col:number, boat:number, count:number, x:number, y:number, h:number}[],
 *   bands: {p:number, a:number, b:number, count:number, y0:number, y1:number, h:number}[]}}
 */
export function sankeyLayout(links, n) {
  const count = [new Map(), new Map(), new Map()];
  for (const [p, a, b, c] of links) {
    if (p === 0) count[0].set(a, (count[0].get(a) ?? 0) + c);
    count[p + 1].set(b, (count[p + 1].get(b) ?? 0) + c);
  }
  const nodes = [];
  count.forEach((m, col) => {
    const boats = [...m.keys()].sort((x, y) => x - y);
    const gaps = Math.max(0, boats.length - 1) * SANKEY.gap;
    const unit = n ? (SANKEY.height - gaps) / n : 0;
    let y = SANKEY.top;
    for (const b of boats) {
      const h = m.get(b) * unit;
      nodes.push({ col, boat: b, count: m.get(b), x: SANKEY.cols[col], y, h });
      y += h + SANKEY.gap;
    }
  });
  const nodeOf = (col, boat) =>
    nodes.find((x) => x.col === col && x.boat === boat);
  // 帯は、出る側・入る側とも相手の艇番の順に積む
  const outUsed = new Map();
  const inUsed = new Map();
  const bands = [...links]
    .sort((u, v) => u[0] - v[0] || u[1] - v[1] || u[2] - v[2])
    .map(([p, a, b, c]) => {
      const from = nodeOf(p, a);
      const to = nodeOf(p + 1, b);
      const unit = from.h / from.count;
      const h = c * unit;
      const ko = `${p}-${a}`;
      const y0 = from.y + (outUsed.get(ko) ?? 0);
      outUsed.set(ko, (outUsed.get(ko) ?? 0) + h);
      return { p, a, b, count: c, y0, h, to };
    });
  // 入る側は前の艇の順
  for (const band of [...bands].sort(
    (u, v) => u.p - v.p || u.b - v.b || u.a - v.a,
  )) {
    const ki = `${band.p}-${band.b}`;
    band.y1 = band.to.y + (inUsed.get(ki) ?? 0);
    inUsed.set(ki, (inUsed.get(ki) ?? 0) + band.h);
    delete band.to;
  }
  return { nodes, bands };
}
export const sankeyNodeBox = (node) => ({
  x: node.x - 8,
  y: node.y - 4,
  w: SANKEY.nodeW + 150,
  h: Math.max(node.h + 8, 60),
});

// よく出た3連単（上位の行）
export const TRI = { rowH: 120, gap: 16, top: BODY_Y + 40 };
export const triRowBox = (i) => ({
  x: LEFT,
  y: TRI.top + i * (TRI.rowH + TRI.gap),
  w: RIGHT - LEFT,
  h: TRI.rowH,
});
export const triRowsBox = (k) => ({
  x: LEFT,
  y: TRI.top,
  w: RIGHT - LEFT,
  h: k * TRI.rowH + (k - 1) * TRI.gap,
});
