import { useState, useMemo } from "react";
import {
  extractHitRaces,
  selectPeriodRaces,
  buildVenueStats,
  sliceDisplayRaces,
} from "./HitRacesLogic";

// 「もっと見る」の開閉（期間ごとに別々に持つ）
function useShowAll(selectedPeriod) {
  const [showAllToday, setShowAllToday] = useState(false);
  const [showAllYesterday, setShowAllYesterday] = useState(false);
  const [showAllPeriod, setShowAllPeriod] = useState(false);

  const toggleShowAll = () => {
    if (selectedPeriod === "today") setShowAllToday(!showAllToday);
    else if (selectedPeriod === "yesterday")
      setShowAllYesterday(!showAllYesterday);
    else setShowAllPeriod(!showAllPeriod);
  };

  const isShowingAll = selectPeriodRaces(
    selectedPeriod,
    showAllToday,
    showAllYesterday,
    showAllPeriod,
  );
  return { toggleShowAll, isShowingAll };
}

// 期間ごとの的中レース・場別統計・表示するレースを組み立てる
export function useHitRacesView(
  selectedPeriod,
  { rawToday, rawYesterday, rawAll },
) {
  const { toggleShowAll, isShowingAll } = useShowAll(selectedPeriod);

  const hitRacesToday = useMemo(() => extractHitRaces(rawToday), [rawToday]);

  const hitRacesYesterday = useMemo(
    () => extractHitRaces(rawYesterday),
    [rawYesterday],
  );

  const hitRacesAll = useMemo(() => extractHitRaces(rawAll), [rawAll]);

  // ボートレース場別の統計を計算
  const venueStats = useMemo(
    () =>
      buildVenueStats(
        selectPeriodRaces(
          selectedPeriod,
          hitRacesToday,
          hitRacesYesterday,
          hitRacesAll,
        ),
      ),
    [selectedPeriod, hitRacesToday, hitRacesYesterday, hitRacesAll],
  );

  const currentHitRaces = selectPeriodRaces(
    selectedPeriod,
    hitRacesToday,
    hitRacesYesterday,
    hitRacesAll,
  );
  const displayRaces = sliceDisplayRaces(
    selectedPeriod,
    currentHitRaces,
    isShowingAll,
  );

  return {
    hasAnyHit: hitRacesToday.length > 0 || hitRacesYesterday.length > 0,
    venueStats,
    currentHitRaces,
    displayRaces,
    toggleShowAll,
    isShowingAll,
  };
}
