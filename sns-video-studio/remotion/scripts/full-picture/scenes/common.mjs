/**
 * 場面の build に共通の小さな関数。画面の計算は src/utils の関数を直接使い、ここには置かない。
 */
import { t } from "../scene2-data.mjs";
import { venueLabel } from "../../../../../src/utils/analogyFormat.js";

export { t };
export const BOATS = [1, 2, 3, 4, 5, 6];
/** 割合（0〜1）→ 小数1桁の % の数（71.1） */
export const pct1 = (p) => (p === null || p === undefined ? null : Math.round(p * 1000) / 10);
/** 割合（0〜1）→ 整数の % の数 */
export const pct0 = (p) => (p === null || p === undefined ? null : Math.round(p * 100));
export const venueName = (code) => venueLabel(Number(code), t);
/** 比べた差（ポイント、小数1桁）と向き */
export function diffOf(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return { diffPt: null, direction: null };
  const d = Math.round((a - b) * 10) / 10;
  return { diffPt: Math.abs(d), direction: d > 0 ? "高い" : d < 0 ? "低い" : null };
}
/** 差の言い方（文型）。1ポイント未満は「ほぼ」と言わず「差は1ポイント未満」。差は小数1桁（19.0ポイント。BOA-913） */
export const diffText = (base, f) =>
  f.diffPt === null ? null : f.diffPt < 1 ? `${base}との差は1ポイント未満` : `${base}より${f.diffPt.toFixed(1)}ポイント${f.direction}`;
