/**
 * useVenueTendencyStats - 会場×枠番単位の傾向データを並列取得するフック
 * （race-detail-analysis-integration FR-2、ADR-0024）
 *
 * useRaceAnalysisData（raceId単位）とは責務を分離し、venueCodeのみで完結する
 * 4つの会場統計（決まり手・トップ発走率・負け決まり手・展示最速転換率）を束ねる。
 * 各関数はサービス層でwithCache済み（同一会場の連続閲覧では再フェッチしない）。
 *
 * 各クエリは独立して解決され、取得できたものから順次stateに反映される
 * （プログレッシブ表示）。個別の取得失敗は該当キーがnullのままになる。
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

const SOURCES = {
  technique: (venueCode) =>
    supabaseDataService.getWinningTechniqueStats(venueCode),
  topStart: (venueCode) => supabaseDataService.getTopStartStats(venueCode),
  losing: (venueCode) => supabaseDataService.getLosingTechniqueStats(venueCode),
  exhibitionTop: (venueCode) =>
    supabaseDataService.getExhibitionTimeTopStats(venueCode),
};

const EMPTY = Object.fromEntries(
  Object.keys(SOURCES).map((name) => [name, null]),
);

export function useVenueTendencyStats(venueCode) {
  const [loaded, setLoaded] = useState({ key: null, data: EMPTY, done: {} });

  const key = venueCode ? String(venueCode) : null;

  useEffect(() => {
    if (!venueCode) return undefined;
    const currentKey = String(venueCode);
    let cancelled = false;

    const applyResult = (name, value) => {
      if (cancelled) return;
      setLoaded((prev) => {
        const base =
          prev.key === currentKey
            ? prev
            : { key: currentKey, data: EMPTY, done: {} };
        return {
          key: currentKey,
          data: { ...base.data, [name]: value },
          done: { ...base.done, [name]: true },
        };
      });
    };

    Object.entries(SOURCES).forEach(([name, fn]) => {
      fn(venueCode)
        .then((value) => applyResult(name, value))
        .catch(() => applyResult(name, null));
    });

    return () => {
      cancelled = true;
    };
  }, [venueCode]);

  const isCurrent = key !== null && loaded.key === key;
  const data = isCurrent ? loaded.data : EMPTY;
  const done = isCurrent ? loaded.done : {};
  const loading =
    key !== null && Object.keys(SOURCES).some((name) => !done[name]);

  return { ...data, loading };
}
