/**
 * raceIndicators の共通の小さな部品（翻訳・数値化・艇別の索引）。
 * raceIndicatorsRowDefs* と raceIndicators が共有する（循環 import を避けるため分けた）
 */
// 訳・数値化の本体は src/pure/raceIndicatorText.js（RA41d）。呼び手の import を変えないための再 export
export {
  TECHNIQUE_KEY_BY_NAME,
  translateTechnique,
  translateTechniqueShort,
  translatePartName,
  toNumber,
} from "../../pure/raceIndicatorText.js";

// 艇の枠番別勝率（枠番での1着数/出走数）。racerStats から算出する。
// 枠番キーは BOA-284 で決定（実進入コースではない。src/utils/racerStats.js）
export function wakuRateOf(statsByBoat, boat) {
  const stats = statsByBoat.get(boat);
  if (!stats) return null;
  const counts = stats.wakuRaceCounts?.[String(boat)];
  if (!counts || !counts.total) return null;
  return {
    wins: counts.wins ?? 0,
    total: counts.total,
    rate: ((counts.wins ?? 0) / counts.total) * 100,
  };
}

export const byBoat = (rows) => {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row.boat_number, row));
  return map;
};
