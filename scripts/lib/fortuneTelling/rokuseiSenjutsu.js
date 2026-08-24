/**
 * 六星占術（運気リズム）
 *
 * spec.mdが指す「12年周期(種子〜減退の12段階)のどの段階か」を決める正確な起点計算式は
 * 公開情報からは確認できなかった（複数サイトが「万年暦から導出した運命数表を使う」とのみ説明し、
 * 具体的な計算式を公開していない）。ユーザー承認のうえ、検証可能な範囲（運命星+陰陽の12分類）
 * のみで代用する（docs/design/racer-fortune-telling/plan.md参照）。
 *
 * 運命星(6種)は日柱の空亡（60干支を10日ずつ6旬に分けた際、その旬で使われない2支）で決まる。
 * 空亡→運命星の対応は検索で複数回照合: 戌亥空亡→土星人、子丑空亡→水星人（他4組は同じ
 * 6分割から機械的に導出）。
 * 陰陽(+/-)は生まれ年の十二支（陽支/陰支）で決まる。2020年=子年(陽)を基準に算出。
 *
 * 運命星+陰陽の12分類を、西洋占星術の12星座と同じ「距離ベースのアスペクト」構造に載せて
 * スコア化する（12段階サイクルの正式な意味付けではなく、検証可能な12分類間の関係性として扱う）。
 */
import { getDayGanzhiIndex } from "./sexagenaryCycle.js";

// 空亡グループ(60干支を10ずつ区切った旬番号 0-5)→運命星
// group0(甲子旬,index0-9)→戌亥空亡→土星人 / group1(甲戌旬,10-19)→申酉空亡→金星人
// group2(甲申旬,20-29)→午未空亡→火星人 / group3(甲午旬,30-39)→辰巳空亡→天王星人
// group4(甲辰旬,40-49)→寅卯空亡→木星人 / group5(甲寅旬,50-59)→子丑空亡→水星人
const STAR_NAMES = [
  "土星人",
  "金星人",
  "火星人",
  "天王星人",
  "木星人",
  "水星人",
];

function getStarIndex(dateStr) {
  const ganzhiIndex = getDayGanzhiIndex(dateStr);
  return Math.floor(ganzhiIndex / 10);
}

// 2020年=子年(陽支)を基準にした十二支インデックス(0=子,1=丑,...)
const YEAR_BRANCH_ANCHOR_YEAR = 2020;

function getYearBranchIndex(year) {
  return (((year - YEAR_BRANCH_ANCHOR_YEAR) % 12) + 12) % 12;
}

// 子寅辰午申戌(偶数index)=陽支、丑卯巳未酉亥(奇数index)=陰支
function getPolarity(dateStr) {
  const year = Number(dateStr.split("-")[0]);
  return getYearBranchIndex(year) % 2 === 0 ? "+" : "-";
}

// 運命星(0-5)×陰陽(2) の12分類インデックス(0-11)
function getCategoryIndex(dateStr) {
  const starIndex = getStarIndex(dateStr);
  const polarity = getPolarity(dateStr);
  return starIndex * 2 + (polarity === "+" ? 0 : 1);
}

function getCategoryLabel(categoryIndex) {
  const starIndex = Math.floor(categoryIndex / 2);
  const polarity = categoryIndex % 2 === 0 ? "+" : "-";
  return `${STAR_NAMES[starIndex]}${polarity}`;
}

// アスペクト距離（0=同分類 〜 6=正反対）ごとのスコア。westernAstrology.jsと同じ配点構造
const ASPECT_SCORES = [80, 55, 75, 30, 90, 40, 25];

function getAspectDistance(a, b) {
  const diff = Math.abs(a - b) % 12;
  return diff > 6 ? 12 - diff : diff;
}

/**
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} targetDate YYYY-MM-DD
 * @returns {{ score: number, label: string }}
 */
export function calculateScore(birthDate, targetDate) {
  const natalCategory = getCategoryIndex(birthDate);
  const targetCategory = getCategoryIndex(targetDate);
  const distance = getAspectDistance(natalCategory, targetCategory);

  return {
    score: ASPECT_SCORES[distance],
    label: `${getCategoryLabel(natalCategory)}×${getCategoryLabel(targetCategory)}`,
  };
}
