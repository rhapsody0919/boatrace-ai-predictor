import { useEffect, useMemo, useState } from "react";
import { supabaseDataService } from "../services/supabaseDataService.js";
import { buildSixBoatCourseRows } from "../components/race/sixBoatCourseStats.js";

/** 公式の期別成績と平均を共有キャッシュ経由で読み、想定コースの6行を返す。 */
export function useSixBoatCourseStats({ raceDate, venueCode, players }) {
  // players の配列や名前が変わっただけでは取得し直さない。
  const racerIdsKey = JSON.stringify(
    (players ?? []).map((p) => p.racerId ?? null),
  );
  const key = JSON.stringify([raceDate, venueCode ?? null, racerIdsKey]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const racerIds = JSON.parse(racerIdsKey);
    async function load() {
      try {
        const [periodRows, baseline] = await Promise.all([
          Promise.all(
            racerIds.map((id) =>
              id == null
                ? Promise.resolve([])
                : supabaseDataService.getRacerAllPeriodStats(id),
            ),
          ),
          supabaseDataService.getCourseWinRateBaseline(raceDate, venueCode),
        ]);
        if (!cancelled) {
          setResult({
            key,
            status: "ready",
            periodRowsByRacer: Object.fromEntries(
              racerIds.map((id, i) => [id, periodRows[i]]),
            ),
            baseline,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) setResult({ key, status: "error", baseline: null, error });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [key, racerIdsKey, raceDate, venueCode]);

  // 切り替え直後も前レースの行やエラーを返さない。艇番の変更は取得せず行だけ作り直す。
  return useMemo(() => {
    if (result?.key !== key) {
      return { status: "loading", rows: [], baseline: null, error: null };
    }
    if (result.status === "error") {
      return { status: "error", rows: [], baseline: null, error: result.error };
    }
    try {
      const rows = buildSixBoatCourseRows({
        players,
        periodRowsByRacer: result.periodRowsByRacer,
        raceDate,
        baseline: result.baseline,
      });
      return { status: "ready", rows, baseline: result.baseline, error: null };
    } catch (error) {
      return { status: "error", rows: [], baseline: null, error };
    }
  }, [key, result, players, raceDate]);
}
