/** 会場・レースの選択（embedded のときは親が描かない） */
const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

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
      <label htmlFor="return-rate-venue-select">
        {t("analysis.venueSelectTodayLabel")}
      </label>
      <select
        id="return-rate-venue-select"
        value={selectedVenue ?? ""}
        onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
        className="venue-select"
      >
        {venues.map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>

      {races.length > 0 && (
        <>
          <label htmlFor="return-rate-race-select">
            {t("analysis.raceSelectLabel")}
          </label>
          <select
            id="return-rate-race-select"
            value={selectedRace ?? ""}
            onChange={(e) => setSelectedRace(e.target.value)}
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
      )}
    </div>
  );
}
