import { test, expect } from "./fixtures.js";

const path = "/race/2026-09-29-16-12";
const key = "boatai-user:favorites:v1";

for (const width of [320, 375, 1440]) {
  test(`${width}px: 名前の下の☆で追加・解除してもレースに留まる（BOA-1270）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ racers: [], venues: [] }));
      localStorage.setItem("boatai:cookie-consent", "rejected");
      window.favoriteEvents = [];
      window.gtag = (...args) => window.favoriteEvents.push(args);
    }, key);
    await page.goto(path);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
    const table = page.locator(".data-race-table .drt-table");
    const cells = table.locator(".drt-name-th");
    const buttons = cells.locator("button[aria-pressed]");
    await expect(buttons).toHaveCount(6);
    await expect(page.locator(".race-entrants button[aria-pressed]")).toHaveCount(0);
    await expect(cells.locator("a button")).toHaveCount(0);
    await expect(table.locator(".drt-sub").first()).toBeVisible({ timeout: 30000 });

    for (let i = 0; i < 6; i++) {
      const button = buttons.nth(i);
      await expect(button).toHaveText("☆");
      await expect(button).toHaveAttribute("aria-pressed", "false");
      const box = await button.boundingBox();
      const link = await cells.nth(i).locator("a").boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(link.y + link.height);
    }
    const fits = await table.evaluate((el) => ({
      scroll: el.parentElement.scrollWidth,
      client: el.parentElement.clientWidth,
      right: el.getBoundingClientRect().right,
      viewport: innerWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(fits.scroll).toBeLessThanOrEqual(fits.client);
    expect(fits.right).toBeLessThanOrEqual(fits.viewport);
    expect(fits.pageOverflow).toBe(0);

    const third = cells.nth(2);
    const racerId = Number((await third.locator("a").getAttribute("href")).split("/").pop());
    const star = third.locator("button[aria-pressed]");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).racers, key)).toEqual([racerId]);
    await expect.poll(() => page.evaluate(() => window.favoriteEvents.filter((e) => e[1] === "favorite_add")))
      .toEqual([["event", "favorite_add", { fav_type: "racer", fav_entry: "race_table", fav_count: 1 }]]);
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).racers, key)).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect.poll(() => page.evaluate(() => window.favoriteEvents.filter((e) => e[1] === "favorite_remove")))
      .toEqual([["event", "favorite_remove", { fav_type: "racer", fav_entry: "race_table", fav_count: 0 }]]);
  });
}
