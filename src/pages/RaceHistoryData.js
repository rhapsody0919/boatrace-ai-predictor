import { useState, useEffect } from "react";
import { dataService } from "../services/dataService";
import { toDateInfos, groupByMonth, latestMonthOf } from "./RaceHistoryLogic";

// 利用可能な日付を取得し、月別にグループ化（サマリーRPCで1回のクエリ）と、月の開閉
export function useRaceHistoryData() {
  const [groupedDates, setGroupedDates] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState({});

  // 月の切り替え
  const toggleMonth = (yearMonth) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [yearMonth]: !prev[yearMonth],
    }));
  };

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);

        // サマリーRPCで全日付分の統計を1回のクエリで取得
        const summary = await dataService.getRaceHistorySummary(90);
        const grouped = groupByMonth(toDateInfos(summary));

        setGroupedDates(grouped);

        // 最新月のみ展開
        const latestMonth = latestMonthOf(grouped);
        if (latestMonth) {
          setExpandedMonths({ [latestMonth]: true });
        }
      } catch (error) {
        console.error("日付データの取得エラー:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  return { groupedDates, loading, expandedMonths, toggleMonth };
}
