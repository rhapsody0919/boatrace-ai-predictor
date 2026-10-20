/**
 * 全貌動画 場面2 の配置（純粋関数）。文字の幅は measure(text, size, weight) を渡して測る
 * （描画では Chromium の canvas、検査では近似）。型: 上帯 y0〜330／図 y340〜1420／吹き出しは図の直下・y1420 より上・
 * x960 より左。Shorts の右のボタン列（x960 より右・y900〜1700）に、押す所・枠・項目名を入れない。
 */
import { lineWidth } from "./scene2Timeline.js";

export const W = 1080;
export const H = 1920;
export const BAND = 330;
export const MIN_TEXT = 36;
/** 項目名・その艇の順位の字の大きさ */
export const NAME_SIZE = 40;
export const SUB_SIZE = MIN_TEXT;
const LABEL_H = 92;
/** 頂点の艇番の札の半径・枠の余白・その外の隙間 */
export const BADGE_R = 28;
export const FRAME_PAD = 14;
const GAP = 16;
const CLEAR = BADGE_R + FRAME_PAD + GAP;
/** 画面の左右の余白と、右のボタン列の境目 */
const SIDE = 40;
const SAFE_RIGHT = 940;
const BUTTONS_TOP = 900;

/** 6艇の札（押す所）。x40〜940 に収める */
export const CHIP = { y: 1150, h: 84, w: 135, step: 153, left: 40 };
export const chipX = (b) => CHIP.left + (b - 1) * CHIP.step;
/** 答えの吹き出し。2行で下端 1408（y1420 より上） */
export const BUBBLE = { x: 60, y: 1252, w: 880, padY: 22, padX: 32 };
export const BUBBLE_INNER = BUBBLE.w - BUBBLE.padX * 2;
/**
 * 吹き出しの行の字。答えの行（lead、既定は1行目）を大きく濃く、ほかの行を小さく薄く。
 * 範囲の行を先に書く答え（場面3①「全国・…N件」→「1着…」）は lead を2行目にする（2026-10-21 オーケストレーター段階1）
 */
export const bubbleLine = (i, lead = 0) =>
  i === lead
    ? { size: 46, weight: 800, color: "#0d1b2e" }
    : lead === 0
      ? { size: 40, weight: 700, color: "#33465f" }
      : // 答えの行が2行目の吹き出しは、前置きの行を最小の字・細く・薄くして差を広げる（46/40 では同じ強さに見えた。visual-designer 2026-10-20 P2）
        { size: MIN_TEXT, weight: 600, color: "#5b6b82" };
/** 吹き出しの中で、図の目印と同じ系統の色で塗る語の色（白地で読める濃さ。全国平均の目印 #2dd4bf の系統） */
export const BUBBLE_ACCENT = "#0f8a7c";
/** 1行に収めるために縮めた後の字の大きさの目安（全角1字＝字の大きさ、半角0.55。描画の fit1 と同じ考え） */
export const bubbleFitSize = (line, i, lead = 0) =>
  Math.min(bubbleLine(i, lead).size, Math.floor(BUBBLE_INNER / Math.max(1, lineWidth(line))));
export const bubbleBottom = (sizes) =>
  BUBBLE.y + BUBBLE.padY * 2 + sizes.reduce((h, s) => h + s * 1.3, 0);

/** 軸の数ごとの重ね図の大きさ（上の項目名の上端が y345 前後、下の項目名が札の列の上に収まる） */
export function radarGeom(n) {
  const R = n <= 5 ? 262 : 240;
  const CY = n <= 5 ? 765 : 740;
  return { CX: W / 2, CY, R };
}

export const angle = (i, n) => -Math.PI / 2 + (2 * Math.PI * i) / n;
export function vertex(i, n, f = 1) {
  const { CX, CY, R } = radarGeom(n);
  return [
    CX + R * f * Math.cos(angle(i, n)),
    CY + R * f * Math.sin(angle(i, n)),
  ];
}

/** その高さで使える右端（右のボタン列にかかる高さは x940 まで） */
const rightLimit = (top, h) => (top + h > BUTTONS_TOP ? SAFE_RIGHT : W - SIDE);
const clampX = (x, w, top, h) =>
  Math.min(Math.max(x, SIDE), rightLimit(top, h) - w);

/**
 * 項目名（＋その艇の順位）の箱。上半分の横の頂点は頂点の横に、収まらなければ上へ。下半分は頂点の下に中央揃え。
 * 箱は頂点の札・枠の余白と重ならない距離（CLEAR）だけ頂点から離す
 * @returns {{x:number, y:number, w:number, h:number}} 文字の箱（左上・幅・高さ）
 */
export function labelBox(i, n, w) {
  const [vx, vy] = vertex(i, n);
  const dx = Math.cos(angle(i, n));
  const dy = Math.sin(angle(i, n));
  const above = () => {
    const y = vy - CLEAR - LABEL_H;
    return { x: clampX(vx - w / 2, w, y, LABEL_H), y, w, h: LABEL_H };
  };
  const below = () => {
    const y = vy + CLEAR;
    // 斜め下の頂点は外側へ寄せる（真下の頂点の札にかからないように）
    const x = Math.abs(dx) < 0.3 ? vx - w / 2 : dx > 0 ? vx - 40 : vx - w + 40;
    return { x: clampX(x, w, y, LABEL_H), y, w, h: LABEL_H };
  };

  if (dy > 0.3) return below();
  if (Math.abs(dx) < 0.3) return above();
  // 横に置く（縦は頂点の高さに中央）
  const y = vy - LABEL_H / 2;
  const x = dx > 0 ? vx + CLEAR : vx - CLEAR - w;
  if (x >= SIDE && x + w <= rightLimit(y, LABEL_H))
    return { x, y, w, h: LABEL_H };
  return above();
}

/** 箱と円が交わるか（枠の余白を足した箱で見る） */
export function boxHitsCircle(box, cx, cy, r, pad = FRAME_PAD) {
  const nx = Math.min(Math.max(cx, box.x - pad), box.x + box.w + pad);
  const ny = Math.min(Math.max(cy, box.y - pad), box.y + box.h + pad);
  return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
}

/** 枠（余白込み）が画面内・右のボタン列の外にあるか */
export function frameInSafeArea(box, pad = FRAME_PAD) {
  const l = box.x - pad;
  const r = box.x + box.w + pad;
  const t = box.y - pad;
  const b = box.y + box.h + pad;
  if (l < 0 || t < BAND || r > W) return false;
  const inButtons = r > SAFE_RIGHT + 20 && b > BUTTONS_TOP && t < 1700;
  return !inButtons;
}

/**
 * 場面2のカード（材料1つ）の配置。右のボタン列（x960〜）にかからないよう x40〜960 に収める（visual-designer 2026-10-20 P1）
 */
export const CARD = { top: 350, left: 40, width: 920, height: 880, barsBase: 350 + 762, barMax: 170, barW: 104, pad: 40 };
export const cardColW = (CARD.width - CARD.pad * 2) / 6;
export const cardColX = (i) => CARD.left + CARD.pad + i * cardColW;
/** 上の2つの箱（6艇で一番高いとき・低いとき） */
export const cardPairBox = (i) => {
  const w = (CARD.width - CARD.pad * 2 - 20) / 2;
  return { x: CARD.left + CARD.pad + i * (w + 20), y: CARD.top + 196, w, h: 220 };
};
/** 棒 i（0〜5、値 pct・最大 max）を、上の%ごと囲う枠 */
export function cardBarFrame(i, pct, max) {
  const top = CARD.barsBase - (pct / max) * CARD.barMax;
  return { x: cardColX(i) + (cardColW - CARD.barW) / 2 - 10, y: top - 58, w: CARD.barW + 20, h: CARD.barsBase - top + 58 };
}
