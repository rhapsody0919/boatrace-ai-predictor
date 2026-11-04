import { test, expect } from "./fixtures.js";
import { rewriteTodayRaces } from "./today-races-rewrite.js";

test.describe.configure({ timeout: 180_000 });

async function prepare(page, favorites = [4320], past = false) {
  await page.addInitScript((racers) => {
    localStorage.setItem("boatai-user:favorites:v1", JSON.stringify({ racers, venues: [] }));
  }, favorites);
  await rewriteTodayRaces(page, (venues) => {
    for (const venue of venues) for (const race of venue.races ?? []) {
      for (const entry of race.entries ?? []) if (entry.racerId === 4320) entry.racerId = 3941;
    }
    const first = venues.find((venue) => venue.races?.length >= 6);
    for (const race of first.races) {
      race.raceGrade = "SG";
      if (race.raceNumber > 6) continue;
      race.startTime = past ? "00:00" : `23:0${race.raceNumber}`;
      race.cancellationStatus = null;
      if (race.raceNumber >= 2) race.entries[0] = {
        ...race.entries[0], racerId: 4320, name: "峰竜太", number: 1, grade: "A1",
      };
    }
  });
}

for (const width of [375, 1440]) {
  test(`${width}px: 出走の順・折り畳み・入口と配置`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page);
    await page.goto("/");
    const section = page.getByTestId("favorite-runs");
    await expect(section.getByRole("heading", { name: "お気に入り選手の出走" })).toBeVisible();
    await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(width === 375 ? 4 : 5);
    if (width === 375) {
      await section.getByRole("button", { name: "あと1件を見る" }).click();
      await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(5);
    }
    const row = section.locator(".favorite-runs__row").first();
    await expect(row).toContainText("23:02");
    await expect(row.getByRole("link", { name: "選手ページ" })).toHaveAttribute("href", "/racer/4320");
    const sonar = row.getByRole("link", { name: "龍神ソナー" });
    if (await sonar.count()) await expect(sonar).toHaveAttribute("href", /\/race\/.+\?tab=sonar$/);
    await section.evaluate((el) => {
      el.addEventListener("click", (event) => event.preventDefault());
      window.favoriteRunEvents = [];
      window.gtag = (...args) => window.favoriteRunEvents.push(args);
    });
    await row.getByRole("link", { name: "選手ページ" }).click();
    expect(await page.evaluate(() => window.favoriteRunEvents)).toContainEqual([
      "event", "today_row_click",
      { row_kind: "run", row_link: "racer_page", row_state: "upcoming", fav_state: "runs" },
    ]);
    await expect(section).not.toContainText(/印|買い目|番目/);
    await expect(page.locator(".venue-grid-card").first()).toBeVisible();
    expect(await section.evaluate((el) => {
      const bottom = el.getBoundingClientRect().bottom;
      return [".sg-now-banner", ".venue-grid-card"].every((selector) =>
        bottom <= document.querySelector(selector).getBoundingClientRect().top);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("保存が空なら区画を出さない", async ({ page }) => {
  await prepare(page, []);
  await page.goto("/");
  await expect(page.locator(".venue-grid-card").first()).toBeVisible();
  await expect(page.getByTestId("favorite-runs")).toHaveCount(0);
});

test("英語は翻訳された入口とJSTを出す", async ({ page }) => {
  await prepare(page);
  await page.goto("/en/");
  const section = page.getByTestId("favorite-runs");
  await expect(section).toBeVisible();
  await expect(section).toContainText("JST");
  expect(await section.evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[translate="no"]').forEach((node) => node.remove());
    return /[\u3040-\u30ff\u3400-\u9fff]/u.test(copy.textContent);
  })).toBe(false);
  await expect(section.locator('a[href$="/assist"]')).toHaveCount(0);
  const sonar = section.locator('a[href*="tab=sonar"]').first();
  if (await sonar.count()) await expect(sonar).toHaveAttribute("href", /^\/en\/race\//);
});

test("締切後の出走はボタンで開閉する", async ({ page }) => {
  await prepare(page, [4320], true);
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  const button = section.getByRole("button", { name: "締切を過ぎた5件" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(5);
  await button.click();
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(0);
});
