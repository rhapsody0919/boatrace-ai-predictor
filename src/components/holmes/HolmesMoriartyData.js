import { useState, useEffect } from "react";
import {
  getMoriartyStats,
  getMoriartyRecommendations,
  getMoriartyROIHistory,
  getMoriartyVenueBreakdown,
  getMoriartyCalibrationData,
} from "../../services/moriartyService";

export function useMoriartyData() {
  const [stats, setStats] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [roiHistory, setRoiHistory] = useState([]);
  const [venueBreakdown, setVenueBreakdown] = useState([]);
  const [calibrationData, setCalibrationData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      getMoriartyStats(),
      getMoriartyRecommendations(null),
      getMoriartyROIHistory(30),
      getMoriartyVenueBreakdown(30),
      getMoriartyCalibrationData(),
    ])
      .then(([s, recs, roi, venue, cal]) => {
        setStats(s || {});
        setRecommendations(recs || []);
        setRoiHistory(roi || []);
        setVenueBreakdown(venue || []);
        setCalibrationData(cal || []);
      })
      .catch((err) => {
        console.error("[HolmesMoriarty] fetch error:", err);
        setError("データの取得に失敗しました");
      })
      .finally(() => setLoading(false));
  }, []);

  return {
    stats,
    recommendations,
    roiHistory,
    venueBreakdown,
    calibrationData,
    loading,
    error,
  };
}
