/**
 * ST の進入コース×級の全国の基準（st_course_baseline の24行）。選手ページの ST の推移の比べる線が使う
 * （オーナー 2026-11-27）。レース詳細の ST考察（RaceWakuInfoTabData）と同じ取得・同じキャッシュ。
 */
import { useEffect, useState } from "react";
import { getStCourseBaseline } from "../services/venueQueries2.js";

/** undefined＝取得中、null＝取得失敗（未公開を含む）、配列＝取得済み */
export function useStCourseBaseline() {
  const [rows, setRows] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    getStCourseBaseline()
      .then((data) => {
        // 未公開（権限なし）は { state: "forbidden" } で返る。失敗と同じく線を引かない
        if (!cancelled) setRows(Array.isArray(data) ? data : null);
      })
      .catch((error) => {
        console.error("ST の進入コース×級の基準の取得に失敗:", error);
        if (!cancelled) setRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return rows;
}
