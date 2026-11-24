/**
 * 表とグラフの数字の書き方（docs/reference/design-system.md「表とグラフ」決まり5・6、
 * オーナー 2026-11-23 承認）。表の部品（src/components/dataDisplay/）と各画面が同じ書き方を使う。
 *
 * - 勝率は小数2桁、率は小数1桁。率の % は値の側で小さく添える（見出しと値で % を二重にしない）ので、
 *   ここでは数字と単位を分けて返す
 * - 件数は桁区切り
 * - 空（null・undefined・NaN）は「—」
 * - 母数が6件未満は少ない母数（灰にし、最良の強調から外す）
 */

/** 空の値の印 */
export const EMPTY = "—";

/** これ未満の母数を「少ない」とする（決まり6） */
export const SMALL_SAMPLE_N = 6;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 決まった桁で丸めた字。丸めて 0 になる負の値は「-0.0」でなく「0.0」 */
export const fixed = (v, digits) => {
  if (!isNum(v)) return EMPTY;
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
};

/** 勝率（7.84）。小数2桁 */
export const formatWinRate = (v) => fixed(v, 2);

/**
 * 率（0〜100 の値）。数字と単位を分けて返す。空なら単位も空
 * @param {number|null|undefined} v 0〜100
 * @param {number} [digits] 既定は小数1桁
 * @returns {{text: string, unit: string}}
 */
export const rateParts = (v, digits = 1) =>
  isNum(v) ? { text: fixed(v, digits), unit: "%" } : { text: EMPTY, unit: "" };

/** 率を1つの字で（title 属性・読み上げ・AI 用のコピー等、単位を小さくできない所） */
export const formatRate = (v, digits = 1) => {
  const { text, unit } = rateParts(v, digits);
  return `${text}${unit}`;
};

/** 件数（1,204）。桁区切り */
export const formatCount = (n) =>
  isNum(n) ? Math.round(n).toLocaleString("ja-JP") : EMPTY;

/** 符号付きの差（+1.2・-0.4・0.0）。上下の色は呼び出し側が trendOf で決める */
export const formatSigned = (v, digits = 1) => {
  const s = fixed(v, digits);
  return isNum(v) && Number(s) > 0 ? `+${s}` : s;
};

/**
 * 上下の向き（決まり6: 緑↑・赤↓だけ）。表示の桁で 0 になる差は向き無し
 * @returns {"up"|"down"|null}
 */
export const trendOf = (v, digits = 1) => {
  if (!isNum(v)) return null;
  const r = Number(v.toFixed(digits));
  if (r > 0) return "up";
  if (r < 0) return "down";
  return null;
};

/** 少ない母数か（灰にし、最良の強調から外す）。母数が分からないときは少ないとしない */
export const isSmallN = (n) => isNum(n) && n < SMALL_SAMPLE_N;
