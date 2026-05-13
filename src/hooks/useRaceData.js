import { useMemo } from "react";

/**
 * useRaceData - selectedRace オブジェクトから会場データを抽出・メモ化
 *
 * 責務：
 * - venueCode, venueName の抽出を一元化
 * - 依存関係を明確化（venueCode が変わったときのみ再計算）
 * - PredictionSection / PredictionPanel 間で処理を統一
 */
export function useRaceData(selectedRace) {
  return useMemo(() => {
    if (!selectedRace) {
      return { venueCode: null, venueName: null };
    }

    const venueCode =
      selectedRace?.rawData?.venueCode || selectedRace?.rawData?.placeCd;
    const venueName = selectedRace.venue;

    return { venueCode, venueName };
  }, [
    selectedRace?.rawData?.venueCode,
    selectedRace?.rawData?.placeCd,
    selectedRace?.venue,
  ]);
}
