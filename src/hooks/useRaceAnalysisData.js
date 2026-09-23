/**
 * useRaceAnalysisData - レース単位の分析データを並列取得するフック（BOA-168）
 * DataRaceTable / RaceBasicInfoTab（BOA-306、racerStatsのみ使用）で共有する。
 * サービス層のwithCache（30分TTL + in-flightデデュープ）により、
 * 同一レースの重複取得は発生しない。
 *
 * 各クエリは独立して解決され、取得できたものから順次stateに反映される
 * （プログレッシブ表示）。最も重い回収率クエリに他の行が引きずられない。
 *
 * 個別の取得失敗は該当キーがnullになるが、**`failed[name]` で「取得に失敗した」と
 * 「取得できて中身が無い」を区別できる**（BOA-359、2026-09-23）。
 * 以前は `.catch(() => applyResult(name, null))` で失敗を握りつぶしており、
 * サービス層が例外を投げるようになっても消費側で無害化されて画面に何も出なかった。
 * 失敗があった場合は消費側で InlineFetchError を出し、`reload()` で取り直す。
 */
import { useState, useEffect, useCallback } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

const SOURCES = {
  motor: (raceId, venueCode) =>
    supabaseDataService.getRaceMotorBreakdown(raceId, venueCode ?? null),
  racerForm: (raceId) => supabaseDataService.getRaceRacerFormBreakdown(raceId),
  stPredictability: (raceId) =>
    supabaseDataService.getRaceStPredictabilityBreakdown(raceId),
  exhibitionTime: (raceId) =>
    supabaseDataService.getRaceExhibitionTimeBreakdown(raceId),
  motorMaintenance: (raceId) =>
    supabaseDataService.getRaceMotorMaintenanceBreakdown(raceId),
  techniqueProfile: (raceId) =>
    supabaseDataService.getRaceTechniqueProfileBreakdown(raceId),
  returnRate: (raceId) =>
    supabaseDataService.getRaceRacerBoatReturnRate(raceId),
  racerStats: (raceId) => supabaseDataService.getRaceRacerStats(raceId),
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
 * （venueCodeは後続のuseRaceAnalysisData呼び出しと同じキャッシュキーになるよう
 * 必ず揃える。省略するとmotorソースのキャッシュキーが分岐し、このprefetch自体が
 * 無駄撃ちになる上、本来のデデュープ効果も得られない）
 */
export function prefetchRaceAnalysisData(raceId, venueCode = null) {
  if (!raceId) return;
  Object.values(SOURCES).forEach((fn) => {
    fn(raceId, venueCode).catch(() => {});
  });
}

export function useRaceAnalysisData(
  raceId,
  { includeResult = false, venueCode = null } = {},
) {
  // key（raceId+オプション）でstateの鮮度を管理し、各クエリの解決ごとに
  // functional setStateでマージする。keyが変わった後に届いた古い結果は捨てる
  const [loaded, setLoaded] = useState({
    key: null,
    data: EMPTY,
    done: {},
    failed: {},
  });
  // reload()でこの値を進め、effectを再実行して取り直す
  // （window.location.reload()でページごと捨てない。RacePitReportSectionと同じ方式）
  const [reloadKey, setReloadKey] = useState(0);

  const key = raceId ? `${raceId}:${includeResult}:${venueCode}` : null;

  useEffect(() => {
    if (!raceId) return undefined;
    const currentKey = `${raceId}:${includeResult}:${venueCode}`;
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

    const applyError = (name) => (error) => {
      console.error(
        `分析データ取得エラー(${name}):`,
        error?.message ?? String(error),
      );
      applyResult(name, null, true);
    };

    Object.entries(SOURCES).forEach(([name, fn]) => {
      fn(raceId, venueCode)
        .then((value) => applyResult(name, value))
        .catch(applyError(name));
    });

    if (includeResult) {
      supabaseDataService
        .getRaceResultSummary(raceId)
        .then((value) => applyResult("resultSummary", value))
        .catch(applyError("resultSummary"));
    }

    return () => {
      cancelled = true;
    };
  }, [raceId, includeResult, venueCode, reloadKey]);

  const reload = useCallback(() => {
    setLoaded({ key: null, data: EMPTY, done: {}, failed: {} });
    setReloadKey((n) => n + 1);
  }, []);

  const isCurrent = key !== null && loaded.key === key;
  const data = isCurrent ? loaded.data : EMPTY;
  const done = isCurrent ? loaded.done : {};
  const failed = isCurrent ? loaded.failed : {};
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
  const hasFailure = Object.values(failed).some(Boolean);

  return { ...data, pending, failed, hasFailure, reload, loading };
}
