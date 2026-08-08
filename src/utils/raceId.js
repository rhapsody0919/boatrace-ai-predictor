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
