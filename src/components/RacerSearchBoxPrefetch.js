import { useState, useRef } from "react";
import { getAllRacersWithGrade } from "../services/racerQueries.js";

// 全選手一覧の先読み。最初の1回だけ取得し、失敗時は空配列にする
export default function useRacerPrefetch() {
  const [racers, setRacers] = useState(null);
  const [loading, setLoading] = useState(false);
  const fetchStartedRef = useRef(false);

  // トリガーのホバー/フォーカス時点で先読みを開始し、クリック後の待ち時間を減らす
  const prefetchRacers = () => {
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;
    setLoading(true);
    getAllRacersWithGrade()
      .then((data) => setRacers(data))
      .catch((err) => {
        console.error("選手一覧取得エラー:", err.message);
        setRacers([]);
      })
      .finally(() => setLoading(false));
  };

  return { racers, loading, prefetchRacers };
}
