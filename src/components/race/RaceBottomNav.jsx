import "./RaceBottomNav.css";

function RaceBottomNav({ races, selectedRace, onNavigate }) {
  const currentIndex = races.findIndex((r) => r.id === selectedRace?.id);
  const prevRace = currentIndex > 0 ? races[currentIndex - 1] : null;
  const nextRace =
    currentIndex < races.length - 1 ? races[currentIndex + 1] : null;

  if (!selectedRace) return null;

  return (
    <nav className="race-bottom-nav">
      <button
        disabled={!prevRace}
        onClick={() => prevRace && onNavigate(prevRace)}
        aria-label={
          prevRace ? `前のレース ${prevRace.raceNumber}R` : "前のレースなし"
        }
      >
        ← {prevRace ? `${prevRace.raceNumber}R` : "-"}
      </button>
      <span className="race-bottom-nav__current">
        {selectedRace.venue} {selectedRace.raceNumber}R
      </span>
      <button
        disabled={!nextRace}
        onClick={() => nextRace && onNavigate(nextRace)}
        aria-label={
          nextRace ? `次のレース ${nextRace.raceNumber}R` : "次のレースなし"
        }
      >
        {nextRace ? `${nextRace.raceNumber}R` : "-"} →
      </button>
    </nav>
  );
}

export default RaceBottomNav;
