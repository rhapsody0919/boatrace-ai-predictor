/**
 * useVenueTendencyStats - 会場×枠番単位の傾向データを並列取得するフック
 * （race-detail-analysis-integration FR-2、ADR-0024）
 *
 * useRaceAnalysisData（raceId単位）とは責務を分離し、venueCodeのみで完結する
 * 4つの会場統計（決まり手・トップ発走率・負け決まり手・展示最速転換率）を束ねる。
 * 各関数はサービス層でwithCache済み（同一会場の連続閲覧では再フェッチしない）。
 *
 * 各クエリは独立して解決され、取得できたものから順次stateに反映される
 * （プログレッシブ表示）。
 *
 * 個別の取得失敗は該当キーがnullになるが、**`failed[name]` で「取得に失敗した」と
 * 「取得できて中身が無い」を区別できる**（BOA-359、2026-09-23）。
 * 以前は `.catch(() => applyResult(name, null))` で失敗を握りつぶしていた。
 */
import { useState, useEffect, useCallback } from "react";
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
  const [loaded, setLoaded] = useState({
    key: null,
    data: EMPTY,
    done: {},
    failed: {},
  });
  // reload()でこの値を進め、effectを再実行して取り直す
  const [reloadKey, setReloadKey] = useState(0);

  const key = venueCode ? String(venueCode) : null;

  useEffect(() => {
    if (!venueCode) return undefined;
    const currentKey = String(venueCode);
    let cancelled = false;

    const applyResult = (name, value, didFail = false) => {
      if (cancelled) return;
      setLoaded((prev) => {
        const base =
          prev.key === currentKey
            ? prev
            : { key: currentKey, data: EMPTY, done: {}, failed: {} };
        return {
          key: currentKey,
          data: { ...base.data, [name]: value },
          done: { ...base.done, [name]: true },
          failed: { ...base.failed, [name]: didFail },
        };
      });
    };

    Object.entries(SOURCES).forEach(([name, fn]) => {
      fn(venueCode)
        .then((value) => applyResult(name, value))
        .catch((error) => {
          console.error(
            `会場傾向データ取得エラー(${name}):`,
            error?.message ?? String(error),
          );
          applyResult(name, null, true);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [venueCode, reloadKey]);

  const reload = useCallback(() => {
    setLoaded({ key: null, data: EMPTY, done: {}, failed: {} });
    setReloadKey((n) => n + 1);
  }, []);

  const isCurrent = key !== null && loaded.key === key;
  const data = isCurrent ? loaded.data : EMPTY;
  const done = isCurrent ? loaded.done : {};
  const failed = isCurrent ? loaded.failed : {};
  const loading =
    key !== null && Object.keys(SOURCES).some((name) => !done[name]);
  const hasFailure = Object.values(failed).some(Boolean);

  return { ...data, failed, hasFailure, reload, loading };
}
