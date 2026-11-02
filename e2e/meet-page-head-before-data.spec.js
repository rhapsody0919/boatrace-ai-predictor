import { test, expect } from "./fixtures.js";

for (const { venue, name, start, date } of [
  { venue: 13, name: "尼崎", start: "2026-10-27", date: "10/27" },
  { venue: 16, name: "児島", start: "2026-09-28", date: "9/28" },
]) {
  test(`${name}の節は取得待ちでも会場・日付のtitleと自分のcanonicalを出す`, async ({
    page,
  }) => {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let requested = false;
    // abort で取得失敗にせず、取得を保留して読み込み中を維持する。
    await page.route(/\/rest\/v1\//, async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/race_series")) {
        requested = true;
      }
      await held;
      await route.abort();
    });
    const path = `/venue/${venue}/meet/${start}`;
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect.poll(() => requested).toBe(true);
      await expect(page.locator(".meet-page h3")).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(name));
      await expect(page).toHaveTitle(new RegExp(date));
      const canonical = page.locator('head link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      await expect(canonical).toHaveAttribute(
        "href",
        `https://www.boat-ai.jp${path}`,
      );
      await expect(page.locator(".meet-page h3")).toBeVisible();
      await expect(page.locator(".meet-ranking__table")).toHaveCount(0);
    } finally {
      release();
    }
  });
}
