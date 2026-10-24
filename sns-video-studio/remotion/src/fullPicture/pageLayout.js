/**
 * 段（STEP）の頁の配置（純粋関数）。頁の部品（pages.jsx）と検査（verify-full-picture-scenes.js）が同じ値を使う。
 * 頁は y360〜1230 に収め（吹き出しは y1252〜）、y900 より下は x940 までに置く（Shorts の右のボタン列を避ける）。
 */
import { BEAT } from "./scene2Timeline.js";

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
export const TABLE = { headH: 80, rowH: 92, firstW: 150, labelW: 230 };
export function tableCol(j, ncols) {
  const w = (RIGHT - LEFT - TABLE.firstW) / ncols;
  return j === 0
    ? { x: LEFT, w: TABLE.firstW }
    : { x: LEFT + TABLE.firstW + (j - 1) * w, w };
}
/** 左の列の幅を変えた表の列（会場名など、文字の左の列） */
export function tableColW(j, ncols, firstW) {
  const w = (RIGHT - LEFT - firstW) / ncols;
  return j === 0 ? { x: LEFT, w: firstW } : { x: LEFT + firstW + (j - 1) * w, w };
}
export const tableRowY = (i, rowH = TABLE.rowH) => BODY_Y + TABLE.headH + i * rowH;
/** 列 j（1〜）を見出しから最後の行まで囲う箱。複数の列なら1つにまとめる */
export function tableColsBox(cols, ncols, nrows = 6, rowH = TABLE.rowH) {
  const xs = cols.map((j) => tableCol(j, ncols));
  const x = Math.min(...xs.map((c) => c.x));
  const r = Math.max(...xs.map((c) => c.x + c.w));
  return { x: x + 6, y: BODY_Y + 6, w: r - x - 12, h: TABLE.headH + nrows * rowH - 12 };
}
/** 行 i を囲う箱 */
export const tableRowBox = (i, rowH = TABLE.rowH) => ({ x: LEFT + 6, y: tableRowY(i, rowH) + 4, w: RIGHT - LEFT - 12, h: rowH - 8 });
/** 行の数に合わせた行の高さ（頁に収める。最大 92） */
export const tableRowH = (nrows) => Math.min(TABLE.rowH, Math.floor((PAGE_BOTTOM - 20 - BODY_Y - TABLE.headH) / Math.max(1, nrows)));

/** 数値の欄（縦に3〜4つ） */
export const STATS = { rowH: 150, gap: 20 };
export const statsRow = (i) => ({
  x: LEFT,
  y: BODY_Y + i * (STATS.rowH + STATS.gap),
  w: RIGHT - LEFT,
  h: STATS.rowH,
});

/**
 * 棒つきの数値の欄（場面3①「堅い？荒れる？」）。棒を欄の幅いっぱいに大きく、数値は棒の上、全国の目印の値は棒の下に置き、
 * 棒と字を重ねない（visual-designer 2026-10-20 P1）
 */
export const STATS_BAR = { h: 360, barTop: 170, barH: 72, padX: 28, markLabelTop: 260 };
export const statsBarRow = (i) => ({ x: LEFT, y: BODY_Y + i * (STATS_BAR.h + STATS.gap), w: RIGHT - LEFT, h: STATS_BAR.h });
/** 棒の箱（欄の中の座標でなく画面の座標） */
export const statsBarBox = (i) => {
  const r = statsBarRow(i);
  return { x: r.x + STATS_BAR.padX, y: r.y + STATS_BAR.barTop, w: r.w - STATS_BAR.padX * 2, h: STATS_BAR.barH };
};

/** 押すボタン（見出しの右） */
export const BUTTON = { x: 700, y: PAGE_TOP + 10, w: 240, h: 84 };

/** スリット図: 6コースの横の線、スタートの線（右）、ST が遅いほど左。下に7つの形の札 */
/** 一番早い艇をスタートの線の少し手前に置き、0.01秒の差を60px で描く（画面のスリット図と同じく差を見せる） */
export const SLIT = { top: BODY_Y + 40, laneH: 60, line: 740, scale: 6000, lead: 40 };
export const slitX = (st, fastest) => SLIT.line - SLIT.lead - (st - fastest) * SLIT.scale;
/**
 * 形の札を「選んだ」見た目にするか。押す前・数字が出る前に選ばれて見えると答えの先出しになるので、
 * 数字が出てから（押して変わり終えてから）0.5秒、枠と同時に選ぶ（visual-designer 2026-10-20 P1）。t は変わり終えてからの時刻
 */
export const SLIT_FORM_ON_AT = BEAT.pause;
export const slitFormOn = (on, t) => Boolean(on) && t >= SLIT_FORM_ON_AT;
export const slitFormBox = (i) => ({ x: LEFT + (i % 3) * 300, y: SLIT.top + 6 * SLIT.laneH + 30 + Math.floor(i / 3) * 90, w: 280, h: 80 });

/** 軸の艇のボタン（6つ）と、その下の2着の棒（5行） */
export const AXIS = { y: BODY_Y, h: 84, w: 135, step: 153 };
export const axisButtonBox = (b) => ({ x: LEFT + (b - 1) * AXIS.step, y: AXIS.y, w: AXIS.w, h: AXIS.h });
export const followerRow = (i) => ({ x: LEFT, y: BODY_Y + 120 + i * 112, w: RIGHT - LEFT, h: 100 });

/** 深掘り: 先頭のカード（材料名・今日の位置と率）と、その下の札 */
export const DEEP = { cardY: BODY_Y, cardH: 300, chipY: BODY_Y + 330, chipH: 80 };
export const deepBox = (nChipRows) => ({ x: LEFT, y: DEEP.cardY, w: RIGHT - LEFT, h: DEEP.cardH + (nChipRows ? 30 + nChipRows * (DEEP.chipH + 16) - 16 : 0) });

/**
 * 場面8のまとめカード（2群）の縦の配置。CTA（footer）まで y1420 より上に収める（Shorts の下の帯 y1450〜 に隠れない。
 * visual-designer 2026-10-20 P1）。「スクショで保存」は1つ目の見出しの右に置く
 */
export const SUMMARY = { top: PAGE_TOP - 10, headH: 64, rowH: 84, gap: 10, footerH: 46, bottom: 1420 };
/**
 * footerLines: 締めの行数（場面8 は2行、hq 契約 10/24 C2）。y1420 に収まらないときは行の高さ rowH だけを詰める
 * （1行ぶんで数えていて、2行目の下端 1430 を検査が見逃していた。visual-designer 2026-10-24 P2）
 */
export function summaryLayout(groups, footerLines = 1) {
  const nRows = groups.reduce((a, g) => a + g.rows.length, 0);
  const fixed = SUMMARY.top + groups.length * (SUMMARY.headH + SUMMARY.gap) + footerLines * SUMMARY.footerH;
  const rowH = nRows ? Math.min(SUMMARY.rowH, Math.floor((SUMMARY.bottom - fixed) / nRows)) : SUMMARY.rowH;
  let y = SUMMARY.top;
  const out = groups.map((g) => {
    const head = y;
    y += SUMMARY.headH;
    const rows = g.rows.map((_, i) => y + i * rowH);
    y += g.rows.length * rowH;
    const line = { top: head + SUMMARY.headH, h: g.rows.length * rowH - 6 };
    y += SUMMARY.gap;
    return { head, rows, line };
  });
  return { groups: out, rowH, footerY: y, footerBottom: y + footerLines * SUMMARY.footerH, saveY: SUMMARY.top + 12 };
}
