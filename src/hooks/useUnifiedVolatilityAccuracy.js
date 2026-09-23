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
      .catch((err) => {
        // 取得失敗はstats=nullのまま消費側の表示に倒す。未処理のPromise拒否にしない
        console.error("イン崩れ精度取得エラー:", err?.message ?? String(err));
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
