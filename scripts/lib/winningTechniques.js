// コース別の既定の分布2つの本体は src/pure/winningTechniques.js（画面の src からも読むため）。ここは同じ名で再 export
import { COURSE_DEFAULT_DISTRIBUTION } from "../../src/pure/winningTechniques.js";
/**
 * 決まり手ユーティリティ
 * DB実測値ベースのコース別デフォルト分布を提供
 */

// 決まり手の日本語→英語キーマッピング
export const TECHNIQUES = {
  逃げ: "nige",
  差し: "sashi",
  まくり: "makuri",
  まくり差し: "makurizashi",
  抜き: "nuki",
  恵まれ: "megumare",
};

// 英語キー→日本語マッピング
export const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};

/**
 * 日本語の決まり手名を英語キーに変換
 * @param {string} jaName - 日本語の決まり手名
 * @returns {string|null} 英語キーまたはnull
 */
export function toTechniqueKey(jaName) {
  return TECHNIQUES[jaName] || null;
}

/**
 * 指定コースのデフォルト決まり手分布を取得
 * @param {number} course - コース番号（1-6）
 * @returns {Object} 決まり手確率分布
 */
export function getDefaultDistribution(course) {
  return COURSE_DEFAULT_DISTRIBUTION[course] || {};
}

export {
  COURSE_DEFAULT_DISTRIBUTION,
  COURSE_DEFAULT_DEFENSE,
} from "../../src/pure/winningTechniques.js";
