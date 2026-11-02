import { fetchRecorded } from "./fixtures.js";

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
      // await しないと、fulfill の失敗が下の catch を素通りする
      if (!Array.isArray(body?.data))
        return await route.fulfill(response.fulfillOptions());
      mutate(body.data);
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        json: body,
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
