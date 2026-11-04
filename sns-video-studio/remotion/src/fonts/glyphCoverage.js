import coverage from "./noto-sans-jp/coverage.js";

/**
 * 同梱の Noto Sans JP が持つ字か（coverage.js は fonts/noto-sans-jp/build.py がフォントと一緒に作る）。
 * 持たない字はブラウザが別のフォントで描く。描く所（Linux の CI など）に日本語の別のフォントが無ければ豆腐（□）になる。
 */
const RANGES = coverage.ranges;

/** 形を持たない字（空白・改行・ゼロ幅・異体字の印）は数えない */
const isInvisible = (cp) =>
  cp <= 0x20 ||
  (cp >= 0x7f && cp <= 0xa0) ||
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x2028 && cp <= 0x202f) ||
  cp === 0x2060 ||
  cp === 0xfeff ||
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0xe0100 && cp <= 0xe01ef);

/** @param {number} cp */
export function isCovered(cp) {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = RANGES[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * 文のうち、同梱のフォントに無い字（重ねずに、出てきた順）
 * @param {string} text
 * @returns {string[]}
 */
export function missingGlyphs(text) {
  const out = new Set();
  for (const ch of text ?? "") {
    const cp = ch.codePointAt(0);
    if (!isInvisible(cp) && !isCovered(cp)) out.add(ch);
  }
  return [...out];
}
