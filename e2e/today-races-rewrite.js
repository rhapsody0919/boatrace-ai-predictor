import { e2eTodayJST, fetchRecorded } from "./fixtures.js";

/**
 * トップが読む本日のレース（Edge API /api/races/today と、失敗時の RPC get_today_races）の応答を
 * 録画から取り、mutate(venues) で書き換えて返す。開催日程に左右されずにトップのカードを確かめるため。
 * 戻りの形は両経路とも { success, data: [{ place_cd, races: [...] }] }
 */
export const TODAY_RACES =
  /\/api\/races\/today|\/rest\/v1\/rpc\/get_today_races/;

export async function rewriteTodayRaces(page, mutate) {
  await page.route(TODAY_RACES, async (route) => {
    try {
      const response = await fetchRecorded(route);
      const body = await response.json().catch(() => null);
      // 深夜（0:00〜7:00 JST）は data が無い・配列でないことがある。[] として mutate に渡す
      const isList = Array.isArray(body?.data);
      const data = isList ? body.data : [];
      mutate(data);
      // await しないと、fulfill の失敗が下の catch を素通りする
      await route.fulfill({
        status: isList ? response.status() : 200,
        headers: response.headers(),
        json: { ...(body ?? {}), success: true, data },
      });
    } catch (e) {
      // 本番データの定期実行（E2E_LIVE=1）では、アサーションが先に通ってページが閉じた後に
      // 残りの応答が届くことがある（BOA-1163）。ページが閉じた後の失敗だけ無視する
      if (page.isClosed() || /has been closed/.test(String(e?.message))) return;
      throw e;
    }
  });
}

/** 応答の会場の会場コード（RPC は place_cd、整形後は placeCd） */
export const venueCodeOf = (venue) => venue.place_cd ?? venue.placeCd;

/** 時計を今日の JST 12:00 に固定する。作った会場の発走が、実行する時刻に依らず「これから」になる */
export async function setJstNoon(page) {
  await page.clock.setFixedTime(new Date(`${e2eTodayJST()}T12:00:00+09:00`));
}

// 録画（または E2E_LIVE の本番）に開催中の会場が n 未満なら、足りない分を作って足す。
// 開催の少ない日・深夜でもテストが黙って緩まない・タイムアウトで落ちないようにする。
// 作った会場の発走は 15:00（setJstNoon の時計で「次のレースがある」）
export function ensureOpenVenues(venues, n) {
  const open = venues.filter((v) => (v.races ?? []).length > 0);
  const used = new Set(venues.map(venueCodeOf));
  for (let code = 1; open.length < n && code <= 24; code++) {
    if (used.has(code)) continue;
    const venue = {
      place_cd: code,
      races: [{ raceNo: 12, startTime: "15:00", placeCd: code, date: null }],
    };
    venues.push(venue);
    open.push(venue);
  }
  return open;
}
