/**
 * useUnifiedModelAccuracy - unifiedモデルの実測精度（複勝的中率・展開的中率）を取得する
 * （BOA-179関連）。レース非依存のグローバルな統計値のため、useRaceAnalysisData
 * （レース単位のSOURCESマップ）とは別の小さい専用フックにしている。
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

export function useUnifiedModelAccuracy() {
  const [accuracy, setAccuracy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabaseDataService
      .getUnifiedModelAccuracy()
      .then((data) => {
        if (!cancelled) setAccuracy(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { accuracy, loading };
}
