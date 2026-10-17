/**
 * /accuracy のイン崩れ注意度の段ごとの実績（BOA-822 task 24、screens S-5、plan §6）の表示用の値（純関数）。
 * 元は夜の in_caution_bands.py が書く accuracy_cache.in_caution_accuracy の prelaunch・postlaunch の片方
 * （{from, to|through, base: {n, nonWin}, byLevel: {low|mid|high: {n, nonWin}}}）。
 */
import { wilsonInterval } from "./wilson.js";

/** これより少ない段は割合・ぶれ幅を出さず件数だけ（screens S-5「件数30未満の段は割合を出さない」） */
export const MIN_RATE_N = 30;

/** 画面の並び（崩れやすい→堅め。承認モック 3-accuracy-375.png） */
const ORDER = ["high", "mid", "low"];

/**
 * @param {{base?: {n: number, nonWin: number}, byLevel?: Record<string, {n: number, nonWin: number}>}|null} section
 * @returns {null | {base: {n: number, rate: number|null}, total: number, rows: Array<{level: string, n: number, share: number|null, rate: number|null, lo: number|null, hi: number|null}>}}
 *   rate・lo・hi・share は 0〜1。件数が MIN_RATE_N 未満の段は rate・lo・hi が null
 */
export function inCautionAccuracyView(section) {
  if (!section?.byLevel) return null;
  const rows = ORDER.map((level) => {
    const { n = 0, nonWin = 0 } = section.byLevel[level] ?? {};
    const interval = n >= MIN_RATE_N ? wilsonInterval(nonWin, n) : null;
    return {
      level,
      n,
      rate: interval ? nonWin / n : null,
      lo: interval ? interval[0] : null,
      hi: interval ? interval[1] : null,
    };
  });
  const total = rows.reduce((s, r) => s + r.n, 0);
  const baseN = section.base?.n ?? 0;
  return {
    base: {
      n: baseN,
      rate: baseN > 0 ? section.base.nonWin / baseN : null,
    },
    total,
    rows: rows.map((r) => ({ ...r, share: total > 0 ? r.n / total : null })),
  };
}

/** 0〜1 の割合を「65.5」の形に（小数1桁。/accuracy の段の割合・ぶれ幅） */
export const pct1 = (rate) => (Math.round(rate * 1000) / 10).toFixed(1);
