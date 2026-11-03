/** キャッシュの全削除で消さない端末内のユーザー保存。 */
export const FAVORITES_KEY = "boatai-user:favorites:v1";
export const RACER_LIMIT = 30;

export function parseFavorites(raw) {
  const empty = { racers: [], venues: [], error: null };
  if (raw === null) return empty;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...empty, error: "Favorites JSON is invalid" };
  }
  if (!value || !Array.isArray(value.racers) || !Array.isArray(value.venues)) {
    return { ...empty, error: "Favorites must contain racers and venues arrays" };
  }
  return {
    racers: [...new Set(value.racers.filter(Number.isInteger))].slice(0, RACER_LIMIT),
    venues: [...new Set(value.venues.filter((v) => Number.isInteger(v) && v >= 1 && v <= 24))],
    error: null,
  };
}

export function serializeFavorites({ racers, venues }) {
  return JSON.stringify({ racers, venues });
}

export function toggleRacer(state, racerId) {
  if (state.racers.includes(racerId)) {
    return { state: { ...state, racers: state.racers.filter((id) => id !== racerId) }, result: "removed" };
  }
  if (state.racers.length >= RACER_LIMIT) {
    return { state: { ...state }, result: "limit" };
  }
  return { state: { ...state, racers: [...state.racers, racerId] }, result: "added" };
}

export function toggleVenue(state, venueCode) {
  const exists = state.venues.includes(venueCode);
  return {
    state: { ...state, venues: exists ? state.venues.filter((code) => code !== venueCode) : [...state.venues, venueCode] },
    result: exists ? "removed" : "added",
  };
}
