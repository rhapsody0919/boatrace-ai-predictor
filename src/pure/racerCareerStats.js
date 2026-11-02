// @ts-check
import { isFinalStage } from "./raceStageConfig.js";

/** @typedef {'ippan'|'G3'|'G2'|'G1'|'PG1'|'SG'} CareerGrade */
/** @typedef {Readonly<{grade: CareerGrade, stage: string|null, finish_raw: string|null}>} CareerRow */
/** @typedef {{first: number, second: number, third: number, finals: number, wins: number}} CareerCounts */

const FINISHES = ["01", "02", "03", "04", "05", "06"];
const ZERO_POINT_STARTS = ["F", "L1", "K1", "S1", "S2"];
/** 出走には数えないが、優出には数える責任外のコード */
const ABSENT_FINALS = ["S0", "K0", "L0"];
/** @type {Record<CareerGrade, readonly number[]>} */
const POINTS = {
  ippan: [10, 8, 6, 4, 2, 1],
  G3: [10, 8, 6, 4, 2, 1],
  G2: [11, 9, 7, 5, 3, 2],
  G1: [11, 9, 7, 5, 3, 2],
  PG1: [11, 9, 7, 5, 3, 2],
  SG: [12, 10, 8, 6, 4, 3],
};

/** isFinalStage（v2）が優勝戦と判定しないが、公式の期別成績が優勝戦として数えるレースの名前（完全一致）。
 * v2 は学習側（scripts/ml/analogy/features.py）と事前登録した規則で共有するため、選手の集計の側だけで足す。
 * どちらも kb に1レースずつ、本体に0件（2026-11-02 の本番の読み取り）:
 *   オオムラGP 2020-01-01-24-12（第2回オオムラグランプリ）、関ヶ原決戦 2023-07-30-06-12（浜名湖 G2 地区対抗戦）
 * 足すと kb の選手×期 20,916行で優出・優勝が公式と全件一致し、この12人×期の勝率も優勝戦の加点で公式に合う
 * （official-data-spec の照合、2026-11-02）
 */
export const CAREER_EXTRA_FINAL_STAGES = Object.freeze(["オオムラGP", "関ヶ原決戦"]);

/** 選手の集計（勝率の加点・優出・優勝）で使う優勝戦の判定。2つの名前は isFinalStage と同じく NFKC と空白の除去をしてから当てる
 * （本体の race_stage は会場の表記がほぼ生で入り、全角の「ＧＰ」等が来る）。
 * @param {string|null|undefined} stage 種別の原文
 * @returns {boolean}
 */
export function isCareerFinalStage(stage) {
  if (isFinalStage(stage)) return true;
  if (typeof stage !== "string") return false;
  return CAREER_EXTRA_FINAL_STAGES.includes(stage.normalize("NFKC").replace(/\s/g, ""));
}

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
    const score = careerFinishPoints(row.grade, isCareerFinalStage(row.stage), row.finish_raw);
    if (score === null) continue;
    points += score;
    starts++;
  }
  // 整数の得点と出走から直接丸め、1.005 等の浮動小数点の境界誤差を避ける。
  return starts === 0 ? null : Math.floor((points * 200 + starts) / (starts * 2)) / 100;
}

/** 優出（優勝戦の走）に数える着のコード。出走（isCareerStart）とは別で、公式の優出回数は
 * 責任外の S0・K0・L0 も数え、NULL は数えない（kb の選手×期 20,916行で racer_period_stats.finals と全件一致、
 * 2026-11-02、official-data-spec）。00 と知らないコードは kb の優勝戦に0件で未照合のため数えない。
 * @param {string|null} finishRaw
 * @returns {boolean}
 */
export function isCareerFinalAppearance(finishRaw) {
  return isCareerStart(finishRaw) || ABSENT_FINALS.includes(finishRaw ?? "");
}

/** 1行は1選手の1走。種別は原文から isCareerFinalStage で判定し、stage_kind は受け取らない。
 * 優出は isCareerFinalAppearance（S0・K0・L0 を含む）。公式に準優出の統計は無いので数えない。
 * @param {readonly CareerRow[]} rows
 * @returns {CareerCounts}
 */
export function careerFinishCounts(rows) {
  const counts = { first: 0, second: 0, third: 0, finals: 0, wins: 0 };
  for (const row of rows) {
    const finish = row.finish_raw;
    if (finish === "01") counts.first++;
    if (finish === "02") counts.second++;
    if (finish === "03") counts.third++;
    if (!isCareerFinalStage(row.stage)) continue;
    if (isCareerFinalAppearance(finish)) counts.finals++;
    if (finish === "01") counts.wins++;
  }
  return counts;
}
