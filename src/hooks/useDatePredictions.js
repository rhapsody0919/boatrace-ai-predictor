/**
 * 指定日付の予測データを2段階（軽量版→フル版）で取得する共有フック。
 * RaceDetail.jsxの2段階ロードパターンを共通化したもの。
 * withCacheのin-flightデデュープにより、会場一覧→レース一覧→レース詳細と
 * ページを遷移しても同一日付の再フェッチは発生しない。
 *
 * errorは「取得に失敗した」(FETCH_FAILED_ERROR)と「取得に成功したが0件」
 * (NO_DATA_ERROR)を区別する。前者は一時的な障害（DBタイムアウト等）、後者は
 * 開催なし・データ未投入で、利用者に見せるべき内容が異なるため混同しない
 */
import { useState, useEffect } from "react";
import { dataService } from "../services/dataService";

export const NO_DATA_ERROR = "no-data";
export const FETCH_FAILED_ERROR = "fetch-failed";

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

        // 軽量版が失敗した場合、フル版も同じ直接クエリのフォールバックで失敗する。
        // 失敗はキャッシュされなくなったため、続けて実行すると障害中のDBに重い
        // 失敗クエリを1表示あたり2回投げることになる。ここで打ち切って負荷を抑える
        if (lightData.fetchFailed) {
          setError(FETCH_FAILED_ERROR);
          setLoading(false);
          return;
        }

        // Phase 2: バックグラウンドでフル版を取得（turnPrediction/racerStats含む）
        const fullData = await dataService.getPredictions(date);
        if (cancelled) return;

        if (fullData.races && fullData.races.length > 0) {
          setRaces(fullData.races);
          setIsFullData(true);
        } else if (!lightData.races || lightData.races.length === 0) {
          // フル版（権威ある取得）が失敗していれば「0件」とは断定できない
          setError(fullData.fetchFailed ? FETCH_FAILED_ERROR : NO_DATA_ERROR);
        }
        setLoading(false);
      } catch (err) {
        console.error("予測データ取得エラー:", err);
        if (!cancelled) {
          setError(FETCH_FAILED_ERROR);
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
