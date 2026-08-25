/**
 * 九星気学（本命星 + 年盤）
 * spec.md準拠: 「年盤」は年家九星（その年の中宮星、年盤全体を決定づける数）と本命星の
 * 五行関係で代用する（順飛/逆飛の磁方陣配置までは踏み込まない簡易版）
 *
 * 本命星の算出式は複数の実例（1980年→二黒土星、1990年→一白水星）で照合済み。
 * 九星気学では立春(2/4固定で代用)〜節分を1年とするため、1/1〜2/3生まれは前年の星として扱う。
 */

const STAR_NAMES = [
  null, // index0は未使用（星番号は1-9）
  "一白水星",
  "二黒土星",
  "三碧木星",
  "四緑木星",
  "五黄土星",
  "六白金星",
  "七赤金星",
  "八白土星",
  "九紫火星",
];

// 星番号(1-9) → 五行index（木0 火1 土2 金3 水4）
const STAR_ELEMENT = [null, 4, 2, 0, 0, 2, 3, 3, 2, 1];

// 四柱推命(shichuSuimei.js)と同じ意味付け: 比和/食傷/財/官殺/印
const RELATION_SCORES = [65, 60, 55, 30, 85];

function digitalRoot(n) {
  let sum = String(n)
    .split("")
    .reduce((a, c) => a + Number(c), 0);
  while (sum > 9) {
    sum = String(sum)
      .split("")
      .reduce((a, c) => a + Number(c), 0);
  }
  return sum;
}

function starFromYear(year) {
  const digitSum = digitalRoot(year);
  let star = 11 - digitSum;
  if (star === 10) star = 1;
  return star;
}

// 立春(2/4固定)を年の境目とした実効年
function getEffectiveYear(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (m === 1 || (m === 2 && d <= 3)) return y - 1;
  return y;
}

/**
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} targetDate YYYY-MM-DD
 * @returns {{ score: number, label: string }}
 */
export function calculateScore(birthDate, targetDate) {
  const natalStar = starFromYear(getEffectiveYear(birthDate));
  const yearStar = starFromYear(getEffectiveYear(targetDate));

  const natalElement = STAR_ELEMENT[natalStar];
  const yearElement = STAR_ELEMENT[yearStar];
  const diff = (((yearElement - natalElement) % 5) + 5) % 5;

  return {
    score: RELATION_SCORES[diff],
    label: `本命${STAR_NAMES[natalStar]}×年盤${STAR_NAMES[yearStar]}`,
  };
}
