/**
 * useRaceAnalysisData - レース単位の分析データ6種を並列取得するフック（BOA-168）
 * DataRaceTable / RaceReview で共有する。サービス層のwithCache（30分TTL）により
 * 同一レースの2回目以降の呼び出しはキャッシュヒットする。
 * Promise.allSettledで個別の取得失敗を許容する（失敗したキーはnull）。
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../services/supabaseDataService";

const EMPTY = {
  motor: null,
  racerForm: null,
  stPredictability: null,
  exhibitionTime: null,
  techniqueProfile: null,
  returnRate: null,
  racerStats: null,
  resultSummary: null,
};

export function useRaceAnalysisData(raceId, { includeResult = false } = {}) {
  // 取得完了したraceId(+オプション)をキーに保持し、表示値は導出する。
  // これによりraceId切替時のリセット用setStateが不要になる
  const [loaded, setLoaded] = useState({ key: null, data: EMPTY });

  const key = raceId ? `${raceId}:${includeResult}` : null;

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        supabaseDataService.getRaceMotorBreakdown(raceId),
        supabaseDataService.getRaceRacerFormBreakdown(raceId),
        supabaseDataService.getRaceStPredictabilityBreakdown(raceId),
        supabaseDataService.getRaceExhibitionTimeBreakdown(raceId),
        supabaseDataService.getRaceTechniqueProfileBreakdown(raceId),
        supabaseDataService.getRaceRacerBoatReturnRate(raceId),
        supabaseDataService.getRaceRacerStats(raceId),
        includeResult
          ? supabaseDataService.getRaceResultSummary(raceId)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const value = (i) =>
        results[i].status === "fulfilled" ? results[i].value : null;
      setLoaded({
        key: `${raceId}:${includeResult}`,
        data: {
          motor: value(0),
          racerForm: value(1),
          stPredictability: value(2),
          exhibitionTime: value(3),
          techniqueProfile: value(4),
          returnRate: value(5),
          racerStats: value(6),
          resultSummary: value(7),
        },
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [raceId, includeResult]);

  const isCurrent = key !== null && loaded.key === key;
  return {
    ...(isCurrent ? loaded.data : EMPTY),
    loading: key !== null && !isCurrent,
  };
}
