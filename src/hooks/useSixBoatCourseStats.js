import { useCallback, useEffect, useMemo, useState } from "react";
import { getRacerAllPeriodStats } from "../services/racerQueries.js";
import { getCourseWinRateBaseline } from "../services/venueQueries.js";
import { buildSixBoatCourseRows } from "../components/race/sixBoatCourseStats.js";

/** 公式の期別成績と平均を共有キャッシュ経由で読み、想定コースの6行を返す。 */
export function useSixBoatCourseStats({ raceDate, venueCode, players }) {
  // players の配列や名前が変わっただけでは取得し直さない。
  const racerIdsKey = JSON.stringify(
    (players ?? []).map((p) => p.racerId ?? null),
  );
  // reloadKey: 失敗のあと取り直す（withCache は失敗を保存しないので、もう一度呼べば取りに行く。BOA-1296）
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const key = JSON.stringify([raceDate, venueCode ?? null, racerIdsKey, reloadKey]);
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
                : getRacerAllPeriodStats(id),
            ),
          ),
          getCourseWinRateBaseline(raceDate, venueCode),
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
  }, [key, racerIdsKey, raceDate, venueCode, reloadKey]);

  // 切り替え直後も前レースの行やエラーを返さない。艇番の変更は取得せず行だけ作り直す。
  return useMemo(() => {
    if (result?.key !== key) {
      return { status: "loading", rows: [], baseline: null, error: null, reload };
    }
    if (result.status === "error") {
      return { status: "error", rows: [], baseline: null, error: result.error, reload };
    }
    try {
      const rows = buildSixBoatCourseRows({
        players,
        periodRowsByRacer: result.periodRowsByRacer,
        raceDate,
        baseline: result.baseline,
      });
      return { status: "ready", rows, baseline: result.baseline, error: null, reload };
    } catch (error) {
      return { status: "error", rows: [], baseline: null, error, reload };
    }
  }, [key, result, players, raceDate, reload]);
}
