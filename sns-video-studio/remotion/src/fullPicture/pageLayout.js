/**
 * 段（STEP）の頁の配置（純粋関数）。頁の部品（pages.jsx）と検査（verify-full-picture-scenes.js）が同じ値を使う。
 * 頁は y360〜1230 に収め（吹き出しは y1252〜）、y900 より下は x940 までに置く（Shorts の右のボタン列を避ける）。
 */
export const PAGE_TOP = 360;
export const PAGE_BOTTOM = 1230;
export const LEFT = 60;
export const RIGHT = 940;
export const TITLE_Y = PAGE_TOP;
/** 見出し（44px）＋小見出し（36px）の下から本体 */
export const BODY_Y = PAGE_TOP + 130;

/** 横棒（6行）: 行 i（0〜5）の箱・棒の範囲 */
export const BARS = {
  rowH: 100,
  gap: 14,
  labelW: 150,
  barX: 230,
  barW: 520,
  valueX: 770,
};
export const barsRow = (i) => ({
  x: LEFT,
  y: BODY_Y + i * (BARS.rowH + BARS.gap),
  w: RIGHT - LEFT,
  h: BARS.rowH,
});

/** 表: 見出しの行＋6行。列 j（0 が艇の列）の箱 */
export const TABLE = { headH: 80, rowH: 92, firstW: 150 };
export function tableCol(j, ncols) {
  const w = (RIGHT - LEFT - TABLE.firstW) / ncols;
  return j === 0
    ? { x: LEFT, w: TABLE.firstW }
    : { x: LEFT + TABLE.firstW + (j - 1) * w, w };
}
export const tableRowY = (i) => BODY_Y + TABLE.headH + i * TABLE.rowH;
/** 列 j（1〜）を見出しから最後の行まで囲う箱。複数の列なら1つにまとめる */
export function tableColsBox(cols, ncols, nrows = 6) {
  const xs = cols.map((j) => tableCol(j, ncols));
  const x = Math.min(...xs.map((c) => c.x));
  const r = Math.max(...xs.map((c) => c.x + c.w));
  return {
    x: x + 6,
    y: BODY_Y + 6,
    w: r - x - 12,
    h: TABLE.headH + nrows * TABLE.rowH - 12,
  };
}
export const tableRowBox = (i, ncols) => ({
  x: LEFT + 6,
  y: tableRowY(i) + 4,
  w: RIGHT - LEFT - 12,
  h: TABLE.rowH - 8,
  ncols,
});

/** 数値の欄（縦に3〜4つ） */
export const STATS = { rowH: 150, gap: 20 };
export const statsRow = (i) => ({
  x: LEFT,
  y: BODY_Y + i * (STATS.rowH + STATS.gap),
  w: RIGHT - LEFT,
  h: STATS.rowH,
});

/** 押すボタン（見出しの右） */
export const BUTTON = { x: 700, y: PAGE_TOP + 10, w: 240, h: 84 };
