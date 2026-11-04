import { flowLinks, trifectaList } from "../../../utils/analogyAggregate.js";

/** 着順の流れの図の大きさ（viewBox 0 0 400 400 の単位）。列の左端・四角の幅・高さ・上の余白・四角の間 */
export const SANKEY_VIEW = 400;
export const SANKEY_X = [44, 188, 332];
export const SANKEY_W = 22;
const H = 340;
const TOP = 30;
const GAP = 8;

/**
 * 着順の流れの配置（純関数）。FinishSankey と撮影用の頁（src/snsCapture、カーソルを置く1着の四角）が同じ配置を使う
 * @param {Record<string, number>} tri 3連単の件数 @param {{first?: number|null, not1?: boolean}} [opts]
 * @returns {{rows: [number[], number][], tot: number, col: Record<number, number>[], scale: number,
 *   pos: Record<number, {y: number, h: number}>[], links: [number, number, number, number][]}}
 *   pos[p][b] は p 列目（0=1着）の b 号艇の四角の上端と高さ
 */
export function sankeyLayout(tri, { first = null, not1 = false } = {}) {
  const rows = trifectaList(tri, { first, not1 });
  const tot = rows.reduce((s, [, c]) => s + c, 0);
  const col = [0, 1, 2].map((p) => {
    const m = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    rows.forEach(([x, c]) => {
      m[x[p]] += c;
    });
    return m;
  });
  const scale = tot ? (H - GAP * 5) / tot : 0;
  const pos = col.map((m) => {
    let y = TOP;
    const o = {};
    for (let b = 1; b <= 6; b++) {
      o[b] = { y, h: Math.max(m[b] * scale, m[b] ? 1.5 : 0) };
      y += o[b].h + GAP;
    }
    return o;
  });
  // 帯の件数は、3連単の一覧と同じ関数から数える（帯の件数＝内訳の合計。BOA-816）
  return { rows, tot, col, scale, pos, links: flowLinks(tri, { first, not1 }) };
}
