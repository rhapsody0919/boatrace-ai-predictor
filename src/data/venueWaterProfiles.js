/**
 * 24会場の水質と干満差（BOAT RACE 公式の場データが正本）
 * 出典: https://www.boatrace.jp/owpc/pc/data/stadium?jcd=01〜24 の「水質」「干満差」
 * （各ページの表記は「2026/06/30現在」。2026-10-12 に24ページすべてを取得して照合）
 *
 * 以前は venues.water_type（docs/db-migration/001_schema.sql の初期データ）を表示に使い、
 * 干満差は「海水か汽水なら潮がある」と水質から推定していた。初期データは8会場で公式と食い違い
 * （唐津を海水とする等）、推定は干満差なしの海水・汽水（蒲郡・常滑・津）で外れていた。
 * 公式が変わったときはこの表と scripts/maintenance/verify-venue-water-profiles.js の両方を直す。
 *
 * waterType: "fresh"（淡水）| "brackish"（汽水）| "sea"（海水）
 * tidal: 干満差「あり」なら true
 */
export const VENUE_WATER_PROFILES = Object.freeze({
  1: Object.freeze({ waterType: "fresh", tidal: false }), // 桐生
  2: Object.freeze({ waterType: "fresh", tidal: false }), // 戸田
  3: Object.freeze({ waterType: "brackish", tidal: true }), // 江戸川
  4: Object.freeze({ waterType: "sea", tidal: true }), // 平和島
  5: Object.freeze({ waterType: "fresh", tidal: false }), // 多摩川
  6: Object.freeze({ waterType: "brackish", tidal: true }), // 浜名湖
  7: Object.freeze({ waterType: "brackish", tidal: false }), // 蒲郡
  8: Object.freeze({ waterType: "sea", tidal: false }), // 常滑
  9: Object.freeze({ waterType: "brackish", tidal: false }), // 津
  10: Object.freeze({ waterType: "fresh", tidal: false }), // 三国
  11: Object.freeze({ waterType: "fresh", tidal: false }), // びわこ
  12: Object.freeze({ waterType: "fresh", tidal: false }), // 住之江
  13: Object.freeze({ waterType: "fresh", tidal: false }), // 尼崎
  14: Object.freeze({ waterType: "sea", tidal: true }), // 鳴門
  15: Object.freeze({ waterType: "sea", tidal: true }), // 丸亀
  16: Object.freeze({ waterType: "sea", tidal: true }), // 児島
  17: Object.freeze({ waterType: "sea", tidal: true }), // 宮島
  18: Object.freeze({ waterType: "sea", tidal: true }), // 徳山
  19: Object.freeze({ waterType: "sea", tidal: true }), // 下関
  20: Object.freeze({ waterType: "sea", tidal: true }), // 若松
  21: Object.freeze({ waterType: "fresh", tidal: false }), // 芦屋
  22: Object.freeze({ waterType: "brackish", tidal: true }), // 福岡
  23: Object.freeze({ waterType: "fresh", tidal: false }), // 唐津
  24: Object.freeze({ waterType: "sea", tidal: true }), // 大村
});

/**
 * @param {number|string} venueCode - 会場コード（1-24）
 * @returns {{ waterType: "fresh"|"brackish"|"sea", tidal: boolean } | null}
 */
export function venueWaterProfile(venueCode) {
  return VENUE_WATER_PROFILES[Number(venueCode)] ?? null;
}
