import { useState, useEffect } from "react";
import { getRaceRacerBoatReturnRate } from "../../services/raceQueries3.js";

/** 選択中のレースの選手×艇番別の成績を取得する（取得のたびに loading・error を親の state へ反映） */
export function useRacerBoatReturnRateBreakdown({
  selectedRace,
  setLoading,
  setError,
  t,
}) {
  const [breakdown, setBreakdown] = useState([]);

  useEffect(() => {
    if (selectedRace === null) return;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getRaceRacerBoatReturnRate(selectedRace);
        setBreakdown(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race racer boat return rate:", err);
      } finally {
        setLoading(false);
      }
    };
    loadBreakdown();
  }, [selectedRace]);

  return breakdown;
}
