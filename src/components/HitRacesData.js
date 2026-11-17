import { useState, useEffect } from "react";
import { dataService } from "../services/dataService";
import { getDateListJST } from "../utils/dateUtils";

async function loadDayPredictions(dateStr) {
  try {
    const data = await dataService.getPredictions(dateStr);
    return data.races || [];
  } catch (error) {
    console.warn(`予想データ読み込みエラー (${dateStr}):`, error);
    return [];
  }
}

// 今日+昨日を先に取得（即表示用）し、残りの日をバックグラウンドで取得する
export function useHitRacesData(todayStr, yesterdayStr) {
  const [rawToday, setRawToday] = useState([]);
  const [rawYesterday, setRawYesterday] = useState([]);
  const [rawAll, setRawAll] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(true);

  // ステップ1: 今日+昨日を取得（即表示用）
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        setInitialLoading(true);

        const [todayPredictions, yesterdayPredictions] = await Promise.all([
          loadDayPredictions(todayStr),
          loadDayPredictions(yesterdayStr),
        ]);

        setRawToday(todayPredictions);
        setRawYesterday(yesterdayPredictions);
        setInitialLoading(false);

        // ステップ2: 残りをバックグラウンドで取得
        const dateList = getDateListJST(14);
        const remainingDates = dateList.filter(
          (d) => d !== todayStr && d !== yesterdayStr,
        );

        const remainingPredictions = await Promise.all(
          remainingDates.map((dateStr) => loadDayPredictions(dateStr)),
        );

        // 全14日分を統合（今日+昨日+残り）
        const allPredictions = [
          todayPredictions,
          yesterdayPredictions,
          ...remainingPredictions,
        ].flat();
        setRawAll(allPredictions);
      } catch (error) {
        console.error("的中レース読み込みエラー:", error);
      } finally {
        setInitialLoading(false);
        setBackgroundLoading(false);
      }
    };

    fetchInitial();
  }, [todayStr, yesterdayStr]);

  return { rawToday, rawYesterday, rawAll, initialLoading, backgroundLoading };
}
