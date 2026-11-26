/** 推移の図（TrendChart・TrendChartLines）の座標の決まりと値の字（部品のファイルから定数を出さないため分けた） */

export const H = 240;
export const PAD = { l: 30, r: 66, t: 18, b: 34 };
// 値の無い走（F・L）の印を置く帯の高さ。値の線の上に取り、図の中（値の線の近く）に置かない（visual-designer 11/26）
export const BAND = 18;
export const FLAG_Y = PAD.t + BAND / 2;

/** 値の字。dropZero なら ST の公式の書き方（0.12 → .12） */
export function fmtValue(v, digits, scale) {
  const s = v.toFixed(digits);
  return scale.dropZero ? s.replace(/^0/, "") : s;
}
