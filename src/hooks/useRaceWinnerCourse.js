/**
 * 結果確定済みのレースで、1着の艇が実際に入ったコースを取る（BOA-708 で AI予想タブに入れた処理を、
 * 結果確定後の共有文でも使うため切り出した。BOA-754）。
 *
 * 的中は艇番で判定するが、前付けで艇番とコースが違ったレースでは「予想通り」と言えない。
 * 当日は Kファイルの同期前なので entry_course で補う（getRaceWinnerCourses）。取得に失敗しても
 * 画面は止めない（コースが分からないだけ。呼び出し側は null を「違うと分かっていない」と扱う）
 *
 * @param {string|null|undefined} raceId
 * @param {boolean} enabled 結果確定済みのときだけ true
 * @returns {{boat: number|null, course: number|null}|null} 表示中のレースの値。未取得・失敗は null
 */
import { useEffect, useState } from "react";
import { dataService } from "../services/dataService";

export function useRaceWinnerCourse(raceId, enabled) {
  const [winner, setWinner] = useState({
    raceId: null,
    boat: null,
    course: null,
  });
  useEffect(() => {
    if (!enabled || !raceId) return undefined;
    let cancelled = false;
    dataService
      .getRaceWinnerCourses([raceId])
      .then((byRace) => {
        const w = byRace[raceId];
        if (!cancelled && w) setWinner({ raceId, ...w });
      })
      .catch((error) => {
        console.error(
          "1着艇の進入コースの取得に失敗（コース不明として扱う）:",
          error,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, raceId]);
  return winner.raceId === raceId ? winner : null;
}
