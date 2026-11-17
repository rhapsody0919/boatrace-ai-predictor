/** 会場・レースの選択（embedded のときは親が描かない） */
const VENUE_NAMES = Object.fromEntries(
  "桐生 戸田 江戸川 平和島 多摩川 浜名湖 蒲郡 常滑 津 三国 びわこ 住之江 尼崎 鳴門 丸亀 児島 宮島 徳山 下関 若松 芦屋 福岡 唐津 大村"
    .split(" ")
    .map((name, i) => [i + 1, name]),
);

function VenueSelect({ venues, selectedVenue, onSelect, t }) {
  return (
    <>
      <label htmlFor="return-rate-venue-select">
        {t("analysis.venueSelectTodayLabel")}
      </label>
      <select
        id="return-rate-venue-select"
        value={selectedVenue ?? ""}
        onChange={(e) => onSelect(parseInt(e.target.value, 10))}
        className="venue-select"
      >
        {venues.map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>
    </>
  );
}

function RaceSelect({ races, selectedRace, onSelect, t }) {
  return (
    <>
      <label htmlFor="return-rate-race-select">
        {t("analysis.raceSelectLabel")}
      </label>
      <select
        id="return-rate-race-select"
        value={selectedRace ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="venue-select"
      >
        {races.map((r) => (
          <option key={r.race_id} value={r.race_id}>
            {t("analysis.raceOption", {
              number: r.race_number,
              time: r.start_time?.slice(0, 5),
            })}
          </option>
        ))}
      </select>
    </>
  );
}

export default function RacerBoatReturnRateChartControls({
  venues,
  loading,
  selectedVenue,
  setSelectedVenue,
  races,
  selectedRace,
  setSelectedRace,
  t,
}) {
  return venues.length === 0 && !loading ? (
    <div className="empty-state">{t("analysis.noRacesToday")}</div>
  ) : (
    <div className="controls-section">
      <VenueSelect
        venues={venues}
        selectedVenue={selectedVenue}
        onSelect={setSelectedVenue}
        t={t}
      />

      {races.length > 0 && (
        <RaceSelect
          races={races}
          selectedRace={selectedRace}
          onSelect={setSelectedRace}
          t={t}
        />
      )}
    </div>
  );
}
