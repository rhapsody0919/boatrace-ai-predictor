import { formatDateShort } from "../utils/formatters";
import { HitRaceCard, HitStats } from "./hits";
import { cardVariant, getMaxDisplay } from "./HitRacesLogic";

function periodTitle(selectedPeriod, todayStr, yesterdayStr) {
  return selectedPeriod === "today"
    ? `今日の的中レース ${formatDateShort(todayStr)}`
    : selectedPeriod === "yesterday"
      ? `昨日の的中レース ${formatDateShort(yesterdayStr)}`
      : "過去14日間の的中レース";
}

function HitRacesListSection({
  selectedPeriod,
  todayStr,
  yesterdayStr,
  currentHitRaces,
  displayRaces,
  winnerCourses,
  handleCardClick,
  toggleShowAll,
  isShowingAll,
}) {
  return (
    <section className={`hit-races-section ${selectedPeriod}`}>
      <h2>
        &#x1F4C5; {periodTitle(selectedPeriod, todayStr, yesterdayStr)}
        {` (${currentHitRaces.length}レース)`}
      </h2>
      <div className="race-cards-grid">
        {displayRaces.map((hitRace) => (
          <HitRaceCard
            key={hitRace.raceId}
            hitRace={hitRace}
            winnerEntryCourse={winnerCourses[hitRace.raceId]?.course ?? null}
            variant={cardVariant(selectedPeriod, hitRace, todayStr)}
            showDate={selectedPeriod === "all"}
            onClick={
              selectedPeriod !== "yesterday" ? handleCardClick : undefined
            }
          />
        ))}
      </div>

      {currentHitRaces.length > getMaxDisplay(selectedPeriod) && (
        <button
          onClick={toggleShowAll}
          className={`show-more-button ${selectedPeriod}`}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          {isShowingAll
            ? "閉じる ▲"
            : `もっと見る (残り${currentHitRaces.length - getMaxDisplay(selectedPeriod)}レース) ▼`}
        </button>
      )}

      <HitStats hitRaces={currentHitRaces} />
    </section>
  );
}

export default HitRacesListSection;
