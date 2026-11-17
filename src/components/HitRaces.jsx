import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import LoadingScreen from "./LoadingScreen";
import { getJSTDateInfo } from "../utils/dateUtils";
import HitRacesVenueSection from "./HitRacesVenueSection";
import HitRacesListSection from "./HitRacesListSection";
import { useHitRacesData } from "./HitRacesData";
import { useHitRacesView } from "./HitRacesView";
import { useWinnerCourses } from "./HitRacesWinnerCourses";
import "./HitRaces.css";

function HitRaces({ lastUpdated, onRefresh, isRefreshing }) {
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState("today");

  const { todayStr, yesterdayStr } = getJSTDateInfo();

  const data = useHitRacesData(todayStr, yesterdayStr);
  const { initialLoading, backgroundLoading } = data;

  const {
    hasAnyHit,
    venueStats,
    currentHitRaces,
    displayRaces,
    toggleShowAll,
    isShowingAll,
  } = useHitRacesView(selectedPeriod, data);

  const handleCardClick = useCallback(
    (hitRace) => {
      navigate(`/race/${hitRace.raceId}`);
    },
    [navigate],
  );

  const displayRaceIds = displayRaces.map((r) => r.raceId).join(",");

  const winnerCourses = useWinnerCourses(displayRaceIds);

  if (initialLoading) {
    return (
      <LoadingScreen
        title="的中レースを読み込み中..."
        description="データを取得しています"
      />
    );
  }

  if (!hasAnyHit) {
    return (
      <div className="no-data-container">
        <div className="icon">&#x1F3AF;</div>
        <h2>展開予測の的中レースはまだありません</h2>
        <p>レース結果が確定すると、ここに的中レースが表示されます。</p>
      </div>
    );
  }

  return (
    <>
      <title>展開予測 的中レース一覧 | 龍神レーダー</title>
      <meta
        name="description"
        content="龍神レーダーの展開予測（1マーク展開）が的中したレース一覧。今日・昨日・過去14日間の的中レースと会場別的中実績を公開。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/hit-races" />
      <div>
        <HitRacesVenueSection
          lastUpdated={lastUpdated}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          selectedPeriod={selectedPeriod}
          setSelectedPeriod={setSelectedPeriod}
          backgroundLoading={backgroundLoading}
          venueStats={venueStats}
        />

        {/* 的中レースセクション */}
        {currentHitRaces.length > 0 && (
          <HitRacesListSection
            selectedPeriod={selectedPeriod}
            todayStr={todayStr}
            yesterdayStr={yesterdayStr}
            currentHitRaces={currentHitRaces}
            displayRaces={displayRaces}
            winnerCourses={winnerCourses}
            handleCardClick={handleCardClick}
            toggleShowAll={toggleShowAll}
            isShowingAll={isShowingAll}
          />
        )}
      </div>
    </>
  );
}

export default HitRaces;
