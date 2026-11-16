import { useState, useEffect } from "react";
import { dataService } from "../services/dataService";

// 表示中のカードの、1着の艇が実際に入ったコース（BOA-708）。前付けで艇番とコースが
// 違うレースだけ「N号艇（Mコース）」と添える補足なので、取れなければ艇番だけを出す
// （失敗は記録して、カードは艇番で描く。的中の一覧そのものは止めない）
export function useWinnerCourses(displayRaceIds) {
  const [winnerCourses, setWinnerCourses] = useState({});
  useEffect(() => {
    if (!displayRaceIds) return undefined;
    let cancelled = false;
    dataService
      .getRaceWinnerCourses(displayRaceIds.split(","))
      .then((courses) => {
        if (!cancelled) setWinnerCourses(courses);
      })
      .catch((error) => {
        console.error(
          "1着艇の進入コースの取得に失敗（艇番だけで表示）:",
          error,
        );
        if (!cancelled) setWinnerCourses({});
      });
    return () => {
      cancelled = true;
    };
  }, [displayRaceIds]);
  return winnerCourses;
}
