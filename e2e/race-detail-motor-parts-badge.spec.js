import { test, expect, fetchRecorded } from "./fixtures.js";

const raceId = "2026-09-29-16-12";
// サービスの includeTarget と締切を実際の取得経路で検証する。
async function mockParts(page, fail = false, firstRun = false) {
  let entries = [];
  await page.route("**/rest/v1/venue_motor_start_dates*", (route) =>
    route.fulfill({ json: [{ start_date: "2026-09-01" }] }));
  await page.route("**/rest/v1/race_results*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    return q.get("select") === "race_id,rank1,rank2,rank3,rank4,rank5,rank6,race_status"
      ? route.fulfill({ json: [] }) : route.fallback();
  });
  await page.route("**/rest/v1/races*", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("select") !== "race_id,race_date") return route.fallback();
    const races = [
      { race_id: "2026-09-01-16-01", race_date: "2026-09-01" },
      { race_id: "2026-09-28-16-01", race_date: "2026-09-28" },
      { race_id: raceId, race_date: "2026-09-29" },
      { race_id: "2026-09-30-16-01", race_date: "2026-09-30" },
    ];
    await route.fulfill({ json: firstRun ? races.filter((r) => r.race_id === raceId) : races });
  });
  await page.route("**/rest/v1/race_entries*", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("select") === "boat_number,player_name,racer_id,motor_number,motor_2rate,motor_3rate") {
      const response = await fetchRecorded(route);
      entries = await response.json();
      return route.fulfill(response.fulfillOptions());
    }
    if (!q.has("motor_number") || !q.get("race_id")?.startsWith("in.")) return route.fallback();
    const entry = entries.find((e) => String(e.motor_number) === q.get("motor_number").slice(3));
    if (fail && entry?.boat_number === 1 && q.get("select") === "race_id,boat_number,racer_id,player_name,grade") return route.abort();
    if (!entry) return route.fulfill({ json: [] });
    const ids = q.get("race_id").slice(4, -1).split(",");
    await route.fulfill({ json: ids.map((id) => ({ ...entry, race_id: id })) });
  });
  await page.route("**/rest/v1/exhibition_data*", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (!q.get("select")?.includes("parts_changed")) return route.fallback();
    const ids = (q.get("race_id") ?? "").slice(4, -1).split(",");
    await route.fulfill({ json: ids.flatMap((id) => Array.from({ length: 6 }, (_, i) => ({
      race_id: id, boat_number: i + 1, propeller_change: true,
      parts_changed: i === 0 ? (id === raceId ? ["ピストン"] : ["リング"]) : [],
    }))) });
  });
}

test("今節の交換札・展開・375px（プロペラ除外、当該展示を含み未来は除外）", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockParts(page);
  await page.goto(`/race/${raceId}?tab=motor`);
  const table = page.locator(".motor-ranking-table");
  await expect(table.locator(".mcc-parts-badge")).toHaveCount(6);
  await expect(table.locator(".mcc-parts-badge").first()).toHaveText("交換2");
  await expect(table.locator(".mcc-parts-badge").nth(1)).toHaveText("交換0");
  await table.locator(".mcc-parts-badge").first().click();
  await expect(page.locator(".mcc-parts-names")).toHaveText("リング、ピストン");
  await expect(table).toBeVisible(); // 行のドリルダウンは開かない
  await expect(page.locator(".mcc-parts-note")).toContainText("効き目は未検証");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const fits = await table.evaluate((el) => {
    const right = el.parentElement.getBoundingClientRect().right;
    return [...el.querySelectorAll(".mcc-parts-badge")].every((badge) =>
      badge.getBoundingClientRect().right <= right);
  });
  expect(fits).toBe(true);
});

test("取得失敗は交換0にしない", async ({ page }) => {
  await mockParts(page, true);
  await page.goto(`/race/${raceId}?tab=motor`);
  await expect(page.locator(".motor-ranking-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".mcc-parts-error")).toBeVisible();
  await expect(page.locator(".mcc-parts-badge")).toHaveCount(5);
  await expect(page.locator(".motor-ranking-table tbody tr").first().locator(".mcc-parts-badge")).toHaveCount(0);
});

test("初日の初走も当該展示の交換を出す", async ({ page }) => {
  await mockParts(page, false, true);
  await page.goto(`/race/${raceId}?tab=motor`);
  await expect(page.locator(".mcc-parts-badge").first()).toHaveText("交換1");
});
