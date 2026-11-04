import { expect, e2eTodayJST } from "./fixtures.js";

/**
 * トップの区画「お気に入り選手の出走」（GS04、BOA-1272〜1274）の e2e の共通部品。
 * 区画は予測の応答（Edge API /api/predictions/{date}?light=true、失敗時は RPC
 * get_predictions_by_date_light）から☆の選手を拾う。開催日程に左右されないよう、その応答を
 * テストの中で組み立てて返す。
 */

/** 選手の出走履歴（getRacerRaceHistory の最初の要求。select は race_id,boat_number だけ） */
export const isHistoryRequest = (url) => {
  const u = new URL(url);
  return (
    u.pathname.endsWith("/rest/v1/race_entries") &&
    u.searchParams.get("select")?.replace(/\s/g, "") === "race_id,boat_number"
  );
};

export const PREDICTIONS =
  /\/api\/predictions\/|\/rest\/v1\/rpc\/get_predictions_by_date/;
export const FAVORITES_KEY = "boatai-user:favorites:v1";
export const VENUE = 12; // 住之江
export const RACER = 4320;

export const raceIdOf = (venue, race) =>
  `${e2eTodayJST()}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`;

/** 住之江 1R〜6R。2R〜6R の1号艇が☆の選手。startTime は既定で録画時刻（JST 10時台）より後 */
export function predictionsBody({
  startTime = (n) => `23:0${n}`,
  withRacer = true,
  seriesDay = 1,
} = {}) {
  const races = [1, 2, 3, 4, 5, 6].map((n) => ({
    raceId: raceIdOf(VENUE, n),
    venueCode: VENUE,
    venue: "住之江",
    raceNumber: n,
    startTime: startTime(n),
    raceGrade: "SG",
    seriesDay,
    cancellationStatus: null,
    entries: [1, 2, 3, 4, 5, 6].map((number) => ({
      number,
      racerId: withRacer && number === 1 && n >= 2 ? RACER : 9000 + number,
      name: withRacer && number === 1 && n >= 2 ? "峰\u3000\u3000竜太" : `選手${number}`,
      grade: "A1",
    })),
    predictions: {},
  }));
  // 別の会場の、☆の選手がいないレース（拾わないこと）
  races.push({
    raceId: raceIdOf(1, 1),
    venueCode: 1,
    venue: "桐生",
    raceNumber: 1,
    startTime: "22:00",
    raceGrade: "ippan",
    cancellationStatus: null,
    entries: [{ number: 1, racerId: 9100, name: "別の選手", grade: "B1" }],
    predictions: {},
  });
  return { date: e2eTodayJST(), races };
}

/** 予測の応答を差し替える。要求の数を返す（☆0件で読まないことを確かめる） */
export async function routePredictions(page, { abort = false, ...options } = {}) {
  const calls = [];
  await page.route(PREDICTIONS, async (route) => {
    calls.push(route.request().url());
    if (abort) return route.abort();
    return route.fulfill({ json: predictionsBody(options) });
  });
  return calls;
}

export async function setFavorites(page, racers, venues = []) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [FAVORITES_KEY, JSON.stringify({ racers, venues })],
  );
}

export async function expectVenueCards(page) {
  await expect(
    page.locator(".venue-grid-card--open, .venue-grid-card--closed"),
  ).toHaveCount(24, { timeout: 30000 });
  await expect(page.locator(".data-fetch-error")).toHaveCount(0);
}

