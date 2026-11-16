import { useState, useEffect } from "react";
import { getUnifiedModelAccuracy } from "../services/predictionQueries3.js";
import { getUnifiedVolatilityAccuracy } from "../services/predictionQueries4.js";
import { errorMessageOf } from "../utils/errorMessage.js";

/** 成績サマリー（展開予測・イン崩れ指数）の取得。マウント時に1回だけ読む */
export default function useAccuracySummary() {
  const [modelAccuracy, setModelAccuracy] = useState(null);
  const [volatilityStats, setVolatilityStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const [accuracyData, volatilityData] = await Promise.all([
          getUnifiedModelAccuracy(),
          getUnifiedVolatilityAccuracy(),
        ]);
        if (!cancelled) {
          setModelAccuracy(accuracyData);
          setVolatilityStats(volatilityData);
        }
      } catch (err) {
        console.error("Failed to load accuracy summary:", err);
        if (!cancelled) setError(errorMessageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  return { modelAccuracy, volatilityStats, loading, error };
}
