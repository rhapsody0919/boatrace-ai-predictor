import { test, expect, e2eTodayJST } from "./fixtures.js";
import { localizePath } from "../src/config/languages.js";

const socialSelectors = [
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];

for (const lang of ["ja", "en"]) {
  test(`レース詳細 ${lang}: OGP・Xカードとcanonical、離脱時の復元`, async ({ page }) => {
    const homePath = localizePath("/", lang);
    await page.goto(homePath);
    const defaults = await Promise.all(
      socialSelectors.map((selector) =>
        page.locator(selector).getAttribute("content"),
      ),
    );
    // 既存 smoke.spec.js と同じ本日の会場→レースの経路。時計は録画に固定される。
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    const racePath = new URL(page.url()).pathname;
    expect(racePath.startsWith(localizePath("/race/", lang))).toBe(true);
    expect(racePath).toContain(`/race/${e2eTodayJST()}-`);
    // ディープリンクでも同じメタを出す。
    await page.goto(racePath, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".race-detail-page-v2 h1")).toBeVisible();
    await expect(page).not.toHaveTitle(defaults[0]);
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveCount(1);
    for (const selector of socialSelectors) {
      await expect(page.locator(selector)).toHaveCount(1);
    }
    // データ到着で「結果・払戻」等へ更新されるので、同じ描画時点の値を比べる。
    await expect
      .poll(() =>
        page.evaluate((selectors) => {
          const description = document.querySelector('meta[name="description"]').content;
          return Boolean(description) && selectors.every((selector, index) =>
            document.querySelector(selector).content ===
              (index % 2 === 0 ? document.title : description),
          );
        }, socialSelectors),
      )
      .toBe(true);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute("href", `https://www.boat-ai.jp${racePath}`);
    const ogUrl = page.locator('meta[property="og:url"]');
    await expect(ogUrl).toHaveCount(1);
    await expect(ogUrl).toHaveAttribute("content", await canonical.getAttribute("href"));

    // ページ再読込ではcleanupを検証できないため、React Routerのリンクで離れる。
    await page.locator(`.breadcrumb a[href="${homePath}"]`).click();
    await expect(page).toHaveURL(homePath);
    for (const [index, selector] of socialSelectors.entries()) {
      await expect(page.locator(selector)).toHaveAttribute("content", defaults[index]);
    }
    await expect(ogUrl).toHaveCount(0);
  });
}
