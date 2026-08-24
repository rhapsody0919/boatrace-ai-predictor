/**
 * 四柱推命（日柱まで。時柱は出生時刻不明のため省略、spec.md準拠）
 * 日柱の干支は連続する60干支周期のため、基準日からの経過日数で算出する。
 * 基準日: 2007-01-01=乙未(60干支の31番目、0=甲子起点)。
 * 1873-01-12=甲子、2008-02-06=丙子、2008-10-05=戊寅の3点でも一致することを確認済み。
 */

const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BRANCHES = [
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
];
const ELEMENTS = ["木", "火", "土", "金", "水"];

const ANCHOR_DATE_UTC = Date.UTC(2007, 0, 1);
const ANCHOR_INDEX = 31; // 乙未

function getDayGanzhiIndex(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const daysDiff = Math.round((t - ANCHOR_DATE_UTC) / 86400000);
  return (((ANCHOR_INDEX + daysDiff) % 60) + 60) % 60;
}

function getStemIndex(ganzhiIndex) {
  return ganzhiIndex % 10;
}

function getElementIndex(stemIndex) {
  // 甲乙=木、丙丁=火、戊己=土、庚辛=金、壬癸=水
  return Math.floor(stemIndex / 2);
}

// 五行の関係ごとのスコア（diff = (対象日の五行 - 日主の五行 + 5) % 5）
// diff0:比和(同じ) diff1:食傷(日主が対象を生む) diff2:財(日主が対象を剋す)
// diff3:官殺(対象が日主を剋す) diff4:印(対象が日主を生む、最も好調)
const RELATION_SCORES = [65, 60, 55, 30, 85];

/**
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} targetDate YYYY-MM-DD
 * @returns {{ score: number, label: string }}
 */
export function calculateScore(birthDate, targetDate) {
  const natalIndex = getDayGanzhiIndex(birthDate);
  const targetIndex = getDayGanzhiIndex(targetDate);

  const natalStemIndex = getStemIndex(natalIndex);
  const targetStemIndex = getStemIndex(targetIndex);
  const natalElement = getElementIndex(natalStemIndex);
  const targetElement = getElementIndex(targetStemIndex);

  const diff = (((targetElement - natalElement) % 5) + 5) % 5;

  const natalGanzhi = STEMS[natalStemIndex] + BRANCHES[natalIndex % 12];
  const targetGanzhi = STEMS[targetStemIndex] + BRANCHES[targetIndex % 12];

  return {
    score: RELATION_SCORES[diff],
    label: `日主${natalGanzhi}(${ELEMENTS[natalElement]})×${targetGanzhi}(${ELEMENTS[targetElement]})`,
  };
}
