import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * トップの「SG開催中」帯（集客レーン、2026-10-02）の固定。
 *
 * 開催日程に左右されないよう、トップが読む本日のレースの応答を録画から取り、書き換えて確かめる。
 * トップは Edge API（/api/races/today）を読み、失敗したら同じ形の RPC（get_today_races）に切り替える
 * （supabaseDataService.getRaces）。両方を同じように書き換える。判定そのものは
 * scripts/maintenance/verify-sg-now-venues.js。
 */

// 開発機の負荷が高いと、最初に開くトップの変換・読み込みが既定の60秒を超えることがある
test.describe.configure({ timeout: 180_000 });

const TODAY_RACES = /\/api\/races\/today|\/rest\/v1\/rpc\/get_today_races/;

async function rewriteTodayRaces(page, mutate) {
  await page.route(TODAY_RACES, async (route) => {
    const response = await fetchRecorded(route);
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.data)) return route.fulfill({ response });
    mutate(body.data);
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: body,
    });
  });
}

test("SGの会場がある日は、トップに開催中の帯を出し、会場ページへリンクする", async ({
  page,
}) => {
  let venueCode = null;
  await rewriteTodayRaces(page, (venues) => {
    const first = venues.find((v) => (v.races ?? []).length > 0);
    venueCode = first.place_cd ?? first.placeCd;
    for (const r of first.races) {
      r.raceGrade = "SG";
      r.raceTitle = "第７３回ボートレースダービー";
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const link = page.locator(".sg-now-banner a.sg-now-banner__link").first();
  await expect(link).toBeVisible({ timeout: 30000 });
  await expect(link).toContainText("第73回ボートレースダービー 開催中");
  await expect(link).toHaveAttribute("href", `/venue/${venueCode}`);
  await expect(link).not.toContainText("競艇");
});

test("SGの会場が無い日は帯を出さない", async ({ page }) => {
  await rewriteTodayRaces(page, (venues) => {
    for (const v of venues)
      for (const r of v.races ?? []) {
        if (r.raceGrade === "SG") r.raceGrade = "ippan";
      }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".venue-grid-card").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".sg-now-banner")).toHaveCount(0);
});
