/**
 * 逃し率の全国の基準（オーナー 2026-11-25）。venue_course_technique_baseline の2コースの行を走数で重み付ける。
 * 定義上、2〜6コースのどれも会場の逃げ率と同じ値（098 の注釈）なので2コースの行だけ読む。
 * 枠別タブのカード（NigashiCard）と選手ページ（RacerNigashiCourses）が使う。
 */
import { useEffect, useState } from "react";
import { nationalNigashiBaseline } from "../pure/nigashiStats.js";
import { getNigashiBaselineRows } from "../services/venueQueries3.js";

/** 全国の基準。undefined＝取得中、null＝取得失敗、値＝取得済み（行が無ければ empty） */
export function useNigashiBaseline() {
  const [state, setState] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    getNigashiBaselineRows(2)
      .then((rows) => {
        if (!cancelled)
          setState(nationalNigashiBaseline(rows) ?? { empty: true });
      })
      .catch((error) => {
        console.error("逃し率の全国の基準の取得に失敗:", error);
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
