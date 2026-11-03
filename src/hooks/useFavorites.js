import { useSyncExternalStore } from "react";
import {
  FAVORITES_KEY, parseFavorites, serializeFavorites,
  toggleRacer, toggleVenue,
} from "../pure/favorites.js";

const subscribers = new Set();
const empty = parseFavorites(null);
let lastRaw;
let snapshot = empty;
let readFailed = false;

function getSnapshot() {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    readFailed = false;
    // React requires the same snapshot object until the stored value changes.
    if (raw !== lastRaw) {
      lastRaw = raw;
      snapshot = parseFavorites(raw);
      if (snapshot.error) console.error("Favorites read failed:", snapshot.error);
    }
    return snapshot;
  } catch (error) {
    if (!readFailed) console.error("Favorites read failed:", error);
    readFailed = true;
    lastRaw = undefined;
    snapshot = empty;
    return empty;
  }
}

function notify() {
  subscribers.forEach((listener) => listener());
}

function onStorage(event) {
  if ((event.key === FAVORITES_KEY || event.key === null) &&
      event.storageArea === window.localStorage) notify();
}

function subscribe(listener) {
  if (subscribers.size === 0) window.addEventListener("storage", onStorage);
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function saveToggle(toggle, id) {
  // Read at click time so successive writes never use a stale render.
  const current = getSnapshot();
  if (readFailed || typeof window === "undefined") return "save_failed";
  const next = toggle(current, id);
  if (next.result === "limit") return "limit";
  try {
    window.localStorage.setItem(FAVORITES_KEY, serializeFavorites(next.state));
  } catch (error) {
    console.error("Favorites save failed:", error);
    return "save_failed";
  }
  notify();
  return next.result;
}

export function useFavorites() {
  const { racers, venues } = useSyncExternalStore(subscribe, getSnapshot, () => empty);
  return {
    racers,
    venues,
    isRacerFavorite: (id) => racers.includes(id),
    isVenueFavorite: (code) => venues.includes(code),
    toggleRacer: (id) => saveToggle(toggleRacer, id),
    toggleVenue: (code) => saveToggle(toggleVenue, code),
  };
}
