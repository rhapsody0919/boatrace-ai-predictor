/**
 * selectedRace からDBの race_id（YYYY-MM-DD-VV-RR）を導出する
 * App.jsx / RaceDetail.jsx の通常パスでは selectedRace.id がそのまま race_id。
 * おすすめページからの自動選択パス（App.jsx）では id が無いため
 * rawData の date/placeCd/raceNo からフォールバック導出する。
 */
export function getRaceId(selectedRace) {
  if (!selectedRace) return null;
  if (selectedRace.id) return selectedRace.id;

  const raw = selectedRace.rawData;
  if (raw?.date && raw?.placeCd != null && raw?.raceNo != null) {
    return `${raw.date}-${String(raw.placeCd).padStart(2, "0")}-${String(raw.raceNo).padStart(2, "0")}`;
  }
  return null;
}

// race_id（YYYY-MM-DD-VV-RR）を {date, venueCode, raceNo} に分解する。
// 形式不正の場合はnull
export function parseRaceId(raceId) {
  if (typeof raceId !== "string") return null;
  const m = raceId.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const venueCode = parseInt(m[2], 10);
  const raceNo = parseInt(m[3], 10);
  if (venueCode < 1 || venueCode > 24 || raceNo < 1 || raceNo > 12) return null;
  return { date: m[1], venueCode, raceNo };
}
