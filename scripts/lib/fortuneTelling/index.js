/**
 * 4占術の共通インターフェース
 * calculateScore(birthDate, targetDate) は { score: 0-100, label? } を返す純粋関数として実装する
 * （4占術間で比較検証できる形式にするため、score は必ず0-100スケールに統一する）
 */
import * as westernAstrology from "./westernAstrology.js";
import * as shichuSuimei from "./shichuSuimei.js";

export const FORTUNE_SYSTEMS = [
  {
    id: "western-astrology",
    name: "西洋占星術",
    calculateScore: westernAstrology.calculateScore,
  },
  {
    id: "shichu-suimei",
    name: "四柱推命",
    calculateScore: shichuSuimei.calculateScore,
  },
];
