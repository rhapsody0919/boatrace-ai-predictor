import { useMemo } from "react";

/**
 * useRaceData - selectedRace オブジェクトから会場データを抽出・メモ化
 *
 * 前提条件：selectedRace は null でない（呼び出し側で確認済み）
 *
 * 責務：
 * - venueCode, venueName の抽出を一元化
 * - 依存関係を明確化（venueCode が変わったときのみ再計算）
 * - PredictionPanel 内で一元的に処理
 */
export function useRaceData(selectedRace) {
  return useMemo(() => {
    // 呼び出し側で selectedRace の存在を確認済みなので、ここでは計算のみ
    const venueCode =
      selectedRace.rawData?.venueCode || selectedRace.rawData?.placeCd;
    const venueName = selectedRace.venue;

    return { venueCode, venueName };
  }, [
    selectedRace.rawData?.venueCode,
    selectedRace.rawData?.placeCd,
    selectedRace.venue,
  ]);
}
