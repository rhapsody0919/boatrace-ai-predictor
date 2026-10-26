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
// 差の計算と言い方は diff.mjs（scene2-data.mjs からも使うので、scene2-data.mjs を読む common.mjs と分ける）
export { Z_LINE, MIN_N, zOf, diffOf, diffWords, diffText, rankOf } from "./diff.mjs";
