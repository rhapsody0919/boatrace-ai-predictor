/**
 * useRaceAnalysisData - レース単位の分析データを並列取得するフック（BOA-168）
 * DataRaceTable / RaceReview で共有する。サービス層のwithCache（30分TTL +
 * in-flightデデュープ）により、同一レースの重複取得は発生しない。
 *
 * 各クエリは独立して解決され、取得できたものから順次stateに反映される
 * （プログレッシブ表示）。最も重い回収率クエリに他の行が引きずられない。
 * 個別の取得失敗は該当キーがnullのままになる。
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

const SOURCES = {
  motor: (raceId) => supabaseDataService.getRaceMotorBreakdown(raceId),
  racerForm: (raceId) => supabaseDataService.getRaceRacerFormBreakdown(raceId),
  stPredictability: (raceId) =>
    supabaseDataService.getRaceStPredictabilityBreakdown(raceId),
  exhibitionTime: (raceId) =>
    supabaseDataService.getRaceExhibitionTimeBreakdown(raceId),
  techniqueProfile: (raceId) =>
    supabaseDataService.getRaceTechniqueProfileBreakdown(raceId),
  returnRate: (raceId) =>
    supabaseDataService.getRaceRacerBoatReturnRate(raceId),
  racerStats: (raceId) => supabaseDataService.getRaceRacerStats(raceId),
  placeOdds: (raceId) => supabaseDataService.getRacePlaceOdds(raceId),
};

const EMPTY = Object.fromEntries(
  [...Object.keys(SOURCES), "resultSummary"].map((name) => [name, null]),
);

const ALL_PENDING = Object.fromEntries(
  [...Object.keys(SOURCES), "resultSummary"].map((name) => [name, true]),
);

/**
 * レース選択直後に呼ぶと分析データの取得を先行開始できる（fire-and-forget）。
 * withCacheのin-flightデデュープにより、後続のフック側の取得と重複しない
 */
export function prefetchRaceAnalysisData(raceId) {
  if (!raceId) return;
  Object.values(SOURCES).forEach((fn) => {
    fn(raceId).catch(() => {});
  });
}

export function useRaceAnalysisData(raceId, { includeResult = false } = {}) {
  // key（raceId+オプション）でstateの鮮度を管理し、各クエリの解決ごとに
  // functional setStateでマージする。keyが変わった後に届いた古い結果は捨てる
  const [loaded, setLoaded] = useState({ key: null, data: EMPTY, done: {} });

  const key = raceId ? `${raceId}:${includeResult}` : null;

  useEffect(() => {
    if (!raceId) return undefined;
    const currentKey = `${raceId}:${includeResult}`;
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
      fn(raceId)
        .then((value) => applyResult(name, value))
        .catch(() => applyResult(name, null));
    });

    if (includeResult) {
      supabaseDataService
        .getRaceResultSummary(raceId)
        .then((value) => applyResult("resultSummary", value))
        .catch(() => applyResult("resultSummary", null));
    }

    return () => {
      cancelled = true;
    };
  }, [raceId, includeResult]);

  const isCurrent = key !== null && loaded.key === key;
  const data = isCurrent ? loaded.data : EMPTY;
  const done = isCurrent ? loaded.done : {};
  const pending = Object.fromEntries(
    Object.keys(ALL_PENDING).map((name) => [
      name,
      // resultSummaryはincludeResult時のみ取得対象（それ以外は常に取得済み扱い）
      name === "resultSummary"
        ? includeResult && key !== null && !done[name]
        : key !== null && !done[name],
    ]),
  );
  const loading =
    key !== null && Object.keys(SOURCES).some((name) => !done[name]);

  return { ...data, pending, loading };
}
