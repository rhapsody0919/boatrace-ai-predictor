import "./RaceBottomNav.css";

function RaceBottomNav({
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

  if (!selectedRace) return null;

  return (
    <nav className="race-bottom-nav">
      <div className="race-bottom-nav__venue-row">
        <div className="race-bottom-nav__venues">
          {venues.map((v) => (
            <button
              key={v.placeCd}
              className={`race-bottom-nav__venue-pill ${
                v.placeCd === selectedVenueId ? "active" : ""
              }`}
              onClick={() => onVenueChange(v.placeCd)}
            >
              {v.placeName}
            </button>
          ))}
        </div>
      </div>

      <div className="race-bottom-nav__race-row">
        <button
          disabled={!prevRace}
          onClick={() => prevRace && onNavigate(prevRace)}
          className="race-bottom-nav__btn"
          aria-label={
            prevRace ? `前のレース ${prevRace.raceNumber}R` : "前のレースなし"
          }
        >
          ← {prevRace ? `${prevRace.raceNumber}R` : "-"}
        </button>
        <span className="race-bottom-nav__current">
          {selectedRace.raceNumber}R
        </span>
        <button
          disabled={!nextRace}
          onClick={() => nextRace && onNavigate(nextRace)}
          className="race-bottom-nav__btn"
          aria-label={
            nextRace ? `次のレース ${nextRace.raceNumber}R` : "次のレースなし"
          }
        >
          {nextRace ? `${nextRace.raceNumber}R` : "-"} →
        </button>
      </div>
    </nav>
  );
}

export default RaceBottomNav;
