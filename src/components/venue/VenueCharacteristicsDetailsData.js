import { useEffect, useState } from "react";
import {
  getOutcomeDistribution,
  getWinningTechniqueStats,
} from "../../services/venueQueries.js";

// 出目分布と決まり手を取る。取得結果は会場とセットで持つ（会場を移ったときに前の会場の表が混ざらない）
export function useVenueDetailsData(venueCode) {
  const [loaded, setLoaded] = useState({ venueCode: null, data: null });
  const [failedVenue, setFailedVenue] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getOutcomeDistribution(venueCode),
      getWinningTechniqueStats(venueCode),
    ])
      .then(([outcomeData, techniqueData]) => {
        if (cancelled) return;
        setFailedVenue(null);
        setLoaded({ venueCode, data: { outcomeData, techniqueData } });
      })
      .catch((err) => {
        console.error("会場の過去90日のデータ取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFailedVenue(venueCode);
      });
    return () => {
      cancelled = true;
    };
  }, [venueCode, reloadKey]);

  const retry = () => {
    // エラーの表示を消してから取り直す（押したことが見て分かるように）
    setFailedVenue(null);
    setReloadKey((n) => n + 1);
  };
  return { loaded, failedVenue, retry };
}
