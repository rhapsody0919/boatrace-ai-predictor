/**
 * 四柱推命（日柱まで。時柱は出生時刻不明のため省略、spec.md準拠）
 * 日柱の干支計算(getDayGanzhiIndex)は sexagenaryCycle.js を参照（六星占術と共有）。
 */
import { STEMS, BRANCHES, getDayGanzhiIndex } from "./sexagenaryCycle.js";

const ELEMENTS = ["木", "火", "土", "金", "水"];

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
