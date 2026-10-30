// @ts-check
import { isFinalStage } from "./raceStageConfig.js";

/** @typedef {'ippan'|'G3'|'G2'|'G1'|'PG1'|'SG'} CareerGrade */
/** @typedef {Readonly<{grade: CareerGrade, stage: string|null, finish_raw: string|null}>} CareerRow */
/** @typedef {{first: number, second: number, third: number, finals: number, wins: number}} CareerCounts */

const FINISHES = ["01", "02", "03", "04", "05", "06"];
const ZERO_POINT_STARTS = ["F", "L1", "K1", "S1", "S2"];
/** @type {Record<CareerGrade, readonly number[]>} */
const POINTS = {
  ippan: [10, 8, 6, 4, 2, 1],
  G3: [10, 8, 6, 4, 2, 1],
  G2: [11, 9, 7, 5, 3, 2],
  G1: [11, 9, 7, 5, 3, 2],
  PG1: [11, 9, 7, 5, 3, 2],
  SG: [12, 10, 8, 6, 4, 3],
};

/** 勝率の分母。原文のコードのみ受け、NULL・00・責任外は除外する。
 * @param {string|null} finishRaw
 * @returns {boolean}
 */
export function isCareerStart(finishRaw) {
  return finishRaw !== null &&
    (FINISHES.includes(finishRaw) || ZERO_POINT_STARTS.includes(finishRaw));
}

/** BOA-1193 の勝率用配点。節の得点率（seriesPoints）とは別表。
 * グレードのレース別補正は呼び出し側で済ませる。
 * @param {CareerGrade} grade
 * @param {boolean} isFinal
 * @param {string|null} finishRaw
 * @returns {number|null} 出走対象外は null、事故の出走は0点（加点なし）
 */
export function careerFinishPoints(grade, isFinal, finishRaw) {
  if (!isCareerStart(finishRaw) || finishRaw === null) return null;
  if (ZERO_POINT_STARTS.includes(finishRaw)) return 0;
  const index = FINISHES.indexOf(finishRaw);
  return POINTS[grade][index] + (isFinal ? (index < 3 ? 1 : 2) : 0);
}

/** @param {readonly CareerRow[]} rows
 * @returns {number|null} 小数第3位を四捨五入した数値。出走0は null。
 */
export function careerWinRate(rows) {
  let points = 0;
  let starts = 0;
  for (const row of rows) {
    const score = careerFinishPoints(row.grade, isFinalStage(row.stage), row.finish_raw);
    if (score === null) continue;
    points += score;
    starts++;
  }
  // 整数の得点と出走から直接丸め、1.005 等の浮動小数点の境界誤差を避ける。
  return starts === 0 ? null : Math.floor((points * 200 + starts) / (starts * 2)) / 100;
}

/** 1行は1選手の1走。種別は原文から v2 判定し、stage_kind は受け取らない。
 * S0・K0 の優出扱いは未定。該当行があれば推測値を返さず止める。
 * @param {readonly CareerRow[]} rows
 * @returns {CareerCounts}
 * @throws {RangeError} 未定の優出条件（優勝戦の S0・K0）を含む場合
 */
export function careerFinishCounts(rows) {
  const counts = { first: 0, second: 0, third: 0, finals: 0, wins: 0 };
  for (const row of rows) {
    const finish = row.finish_raw;
    if (finish === "01") counts.first++;
    if (finish === "02") counts.second++;
    if (finish === "03") counts.third++;
    if (!isFinalStage(row.stage)) continue;
    if (finish === "S0" || finish === "K0") {
      throw new RangeError("S0・K0 の優出条件は未定");
    }
    if (isCareerStart(finish)) counts.finals++;
    if (finish === "01") counts.wins++;
  }
  return counts;
}
