/**
 * get_today_races（RPC。Edge API /api/races/today はこの結果をそのまま返す）の出力を、画面の形に整える。
 *
 * 人の画面（supabaseDataService.getRaces）と、ボット向け HTML の関数（ADR 0089）の両方が使う。
 * Node からも import するため、ブラウザ専用の依存（supabaseClient・import.meta.env・localStorage）を
 * 持ち込まない。import は拡張子付きで書く。検証: scripts/maintenance/verify-bot-page-model.js
 */
import { STADIUM_NAMES } from "../constants/index.js";

/**
 * Edge API の経路と、Edge API が失敗したときに RPC を直接呼ぶ経路の両方が使う（BOA-668）
 *
 * @param {{data: object[], scrapedAt?: string}} data - get_today_races の戻り
 * @param {Record<number, number>} [venueWinRateMap] - 会場コード→1コース勝率（荒れ度バッジの補助値）
 */
export function transformTodayRaces(data, venueWinRateMap = {}) {
  return {
    success: true,
    data: data.data.map((venue) => ({
      placeCd: venue.place_cd || venue.placeCd,
      placeName:
        venue.place_name ||
        venue.placeName ||
        STADIUM_NAMES[venue.place_cd || venue.placeCd],
      races: (venue.races || []).map((race) => ({
        ...race,
        volatility: race.volatility
          ? {
              ...race.volatility,
              venueWinRate: venueWinRateMap[race.placeCd] ?? null,
            }
          : null,
      })),
    })),
    scrapedAt: data.scrapedAt || new Date().toISOString(),
  };
}
