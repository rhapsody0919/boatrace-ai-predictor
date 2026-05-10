import "./RaceNavCard.css";

function RaceNavCard({
  races,
  selectedRace,
  onNavigate,
  venues,
  selectedVenueId,
  onVenueChange,
}) {
  const currentIndex = races.findIndex((r) => r.id === selectedRace?.id);
  const prevRace = currentIndex > 0 ? races[currentIndex - 1] : null;
  const nextRace =
    currentIndex < races.length - 1 ? races[currentIndex + 1] : null;

  if (!selectedRace || (!prevRace && !nextRace)) return null;

  return (
    <div className="race-nav-card">
      <p className="race-nav-card__title">その他のレース</p>
      <div className="race-nav-card__row">
        {prevRace && (
          <button
            className="race-nav-card__button"
            onClick={() => onNavigate(prevRace)}
            aria-label={`前のレース ${prevRace.raceNumber}R ${prevRace.startTime}`}
          >
            <span className="race-nav-card__arrow">←</span>
            <span className="race-nav-card__race">{prevRace.raceNumber}R</span>
            <span className="race-nav-card__time">{prevRace.startTime}</span>
          </button>
        )}
        {nextRace && (
          <button
            className="race-nav-card__button"
            onClick={() => onNavigate(nextRace)}
            aria-label={`次のレース ${nextRace.raceNumber}R ${nextRace.startTime}`}
          >
            <span className="race-nav-card__race">{nextRace.raceNumber}R</span>
            <span className="race-nav-card__time">{nextRace.startTime}</span>
            <span className="race-nav-card__arrow">→</span>
          </button>
        )}
      </div>

      {venues && venues.length > 0 && (
        <>
          <p className="race-nav-card__venue-title">会場を変える</p>
          <div className="race-nav-card__venues">
            {venues.map((v) => (
              <button
                key={v.placeCd}
                className={`race-nav-card__venue-pill ${
                  v.placeCd === selectedVenueId ? "active" : ""
                }`}
                onClick={() => onVenueChange(v.placeCd)}
              >
                {v.placeName}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default RaceNavCard;
