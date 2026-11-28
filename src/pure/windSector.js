/**
 * 風の扇形×風速の5区分（weather-in-escape の事前登録 3.1、docs/design/data-gaps/plan.md §3.1）。
 * facts の書き手（scripts/lib/raceFactsKb.js・raceFactsMain.js）が両方の era の race_facts.wind_sector を決める。
 *
 * 風向の入力は era で意味が違う（preregistration 1.1）:
 * - main: race_conditions.wind_direction。16方位の名だが中身は公式の画面の矢印の番号（「東」=5番＝追い風、会場によらない）
 * - kb: kb_archive_races.wind_direction。K ファイルの本当の方位（8方位＋無風）。矢印の番号 r = (k + offset) mod 16
 * 追い風からの角度 φ = (r − 4) × 22.5° を −180〜180 にし、|φ| ≤ 45 を追い風、≥ 135 を向かい風、ほかを横風とする。
 * K は8方位なので、offset が奇数の会場では kb の行が ±135° に入れない（weather-in-escape results §3.1）。era をまたいで比べない
 */

export const WIND_SECTORS = Object.freeze(["head_strong", "head", "calm_cross", "tail", "tail_strong"]);

const DIRECTIONS = Object.freeze([
  "北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
  "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西",
]);

/**
 * 会場ごとの「画面の矢印の番号 − K の方位の番号」（16分の1周の単位）。
 * src/utils/windDirection.js の VENUE_WIND_OFFSET_DEG ÷ 22.5、scripts/analysis/analyze-weather-in-escape.js の
 * VENUE_WIND_OFFSET と同じ（verify-wind-sector.js が照らす。src/pure は src/utils を読めないので写しを持つ）
 */
export const VENUE_ARROW_OFFSET = Object.freeze({
  1: 5, 2: 7, 3: 11, 4: 12, 5: 0, 6: 4, 7: 2, 8: 0, 9: 15, 10: 5, 11: 4, 12: 4,
  13: 1, 14: 6, 15: 14, 16: 4, 17: 2, 18: 14, 19: 2, 20: 1, 21: 8, 22: 9, 23: 3, 24: 10,
});

/** 矢印の番号（0〜15）。分からなければ null */
function arrowIndex(era, venueCode, direction) {
  const i = DIRECTIONS.indexOf(direction);
  const offset = VENUE_ARROW_OFFSET[venueCode];
  if (i < 0 || offset == null) return null;
  return era === "main" ? i : (i + offset) % 16;
}

/**
 * @param {{ era: "kb"|"main", venueCode: number, direction: string|null, speed: number|null, hasCondition: boolean }} input
 *   hasCondition は race_facts.condition_source が NULL でないか（NULL なら wind_sector も NULL でないと 212 の CHECK に当たる）
 * @returns {string|null} WIND_SECTORS のどれか。風速が無い、風速2m以上で向きが分からない、条件が無ければ null
 */
export function windSectorOf({ era, venueCode, direction, speed, hasCondition }) {
  if (era !== "kb" && era !== "main") throw new Error(`windSectorOf: era は kb か main（${era}）`);
  if (!hasCondition || speed == null) return null;
  if (speed <= 1 || direction === "無風") return "calm_cross";
  const r = arrowIndex(era, venueCode, direction);
  if (r == null) return null;
  const deg = (r - 4) * 22.5;
  const phi = Math.abs(deg > 180 ? deg - 360 : deg);
  const strong = speed >= 4;
  if (phi <= 45) return strong ? "tail_strong" : "tail";
  if (phi >= 135) return strong ? "head_strong" : "head";
  return "calm_cross";
}
