/**
 * RaceResult のデータ取得フック（スタートタイミング・締切時オッズ）。
 * RaceResult.jsx から移しただけ。state・effect の順と依存は元のまま。
 */
import { useEffect, useState } from "react";
import { getRaceFinalOdds } from "../../services/raceQueries3.js";
import { getRaceStartTimings } from "../../services/raceQueries4.js";

export function useRaceResultData(finished, raceId) {
  // 取得結果は raceId とセットで持つ（別レースへ移ったとき前レースのデータを混ぜない）。
  // 失敗も state に残し、「データなし」と区別して InlineFetchError を出す（frontend-data-fetch.md）
  const [startTimingState, setStartTimingState] = useState({
    raceId: null,
    data: null,
    failed: false,
  });
  const [reloadKey, setReloadKey] = useState(0);
  // 締切時オッズ（公式、BOA-496）。単勝・複勝の人気を出すためだけに使う（BOA-534）。取れなくても払戻は出す
  const [finalOddsState, setFinalOddsState] = useState({
    raceId: null,
    data: null,
  });

  // スタート情報は1対多テーブル（race_start_timings）のため、一覧取得のRPCには
  // 含めず結果確定後にレース単位で個別フェッチする（BOA-238）
  useEffect(() => {
    if (!finished || !raceId) return undefined;
    let cancelled = false;
    getRaceStartTimings(raceId)
      .then((data) => {
        if (!cancelled) setStartTimingState({ raceId, data, failed: false });
      })
      .catch((err) => {
        // 取得失敗時はST列を空欄にし、着順は rank1〜 の表示に倒す（レイアウトは維持）。
        // 失敗したことは state に残して InlineFetchError を出す
        console.error(
          "スタートタイミング取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) {
          setStartTimingState({ raceId, data: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId, reloadKey]);

  useEffect(() => {
    if (!finished || !raceId) return undefined;
    let cancelled = false;
    getRaceFinalOdds(raceId)
      .then((data) => {
        if (!cancelled) setFinalOddsState({ raceId, data });
      })
      .catch((err) => {
        // 単勝・複勝の人気を出さないだけ（公式の払戻と他の券種の人気はそのまま出す）
        console.error("締切時オッズ取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFinalOddsState({ raceId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId]);

  return {
    startTimingState,
    finalOddsState,
    reload: () => setReloadKey((key) => key + 1),
  };
}
