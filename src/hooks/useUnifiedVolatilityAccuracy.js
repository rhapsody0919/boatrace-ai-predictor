/**
 * useUnifiedVolatilityAccuracy - unifiedモデルのイン崩れ指数の実測精度
 * （レベル別イン崩れ率）を取得する（BOA-177）。useUnifiedModelAccuracyと同じ
 * パターンの、レース非依存のグローバル統計値専用フック。
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

export function useUnifiedVolatilityAccuracy() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabaseDataService
      .getUnifiedVolatilityAccuracy()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, loading };
}
