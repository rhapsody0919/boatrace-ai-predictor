/**
 * 指定日付の予測データを2段階（軽量版→フル版）で取得する共有フック。
 * RaceDetail.jsxの2段階ロードパターンを共通化したもの。
 * withCacheのin-flightデデュープにより、会場一覧→レース一覧→レース詳細と
 * ページを遷移しても同一日付の再フェッチは発生しない。
 */
import { useState, useEffect } from "react";
import { dataService } from "../services/dataService";

export function useDatePredictions(date) {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFullData, setIsFullData] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        setIsFullData(false);

        // Phase 1: 軽量版で即座に一覧表示
        const lightData = await dataService.getPredictions(date, {
          light: true,
        });
        if (cancelled) return;

        if (lightData.races && lightData.races.length > 0) {
          setRaces(lightData.races);
          setLoading(false);
        }

        // Phase 2: バックグラウンドでフル版を取得（turnPrediction/racerStats含む）
        const fullData = await dataService.getPredictions(date);
        if (cancelled) return;

        if (fullData.races && fullData.races.length > 0) {
          setRaces(fullData.races);
          setIsFullData(true);
        } else if (!lightData.races || lightData.races.length === 0) {
          setError("no-data");
        }
        setLoading(false);
      } catch (err) {
        console.error("予測データ取得エラー:", err);
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return { races, loading, isFullData, error };
}
