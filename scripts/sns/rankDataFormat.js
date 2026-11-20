// rank-data.js から移した、日付・数の整形の小関数（JST の今日・スラッシュ区切り・丸め）
import { getTodayDateJST } from "../lib/dateUtils.js";

export const jstToday = getTodayDateJST;
export const slash = (d) => d.replaceAll("-", "/");
export const round = (v, digits) =>
  v === null || v === undefined ? null : Number(v.toFixed(digits));
