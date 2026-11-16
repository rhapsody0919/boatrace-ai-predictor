import { test, expect } from "./fixtures.js";
import { localizePath } from "../src/config/languages.js";
import { homeSocialProblems, leftPageSocialValues } from "./home-social-meta.js";
import { ensureOpenVenues, rewriteTodayRaces } from "./today-races-rewrite.js";

// all-pages-layout の PAGES と同じ固定の過去日
const RACE_DATE = "2026-08-11";

const socialSelectors = [
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];

// BOA-1584: 今日のトップの開催中の会場の数。0（0:00〜7:00 JST 前後）なら今日の開催を前提とする en は skip する
async function openVenueCount(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  return page.locator(".venue-grid-card--open").count();
}

for (const lang of ["ja", "en"]) {
  test(`レース詳細 ${lang}: OGP・Xカードとcanonical、離脱時の復元`, async ({ page }) => {
    test.skip(lang === "en" && (await openVenueCount(page)) === 0, "開催場なし");
    const homePath = localizePath("/", lang);
    await page.goto(homePath);
    const defaults = await Promise.all(
      socialSelectors.map((selector) =>
        page.locator(selector).getAttribute("content"),
      ),
    );
    // 会場→レースの経路。ja は今日の開催に依らないよう、固定の過去日の会場一覧から入る。
    // /races/{日付} は ja 専用（/en/races/… は ja 版へ移る）ので、en は今日のトップから入る
    if (lang === "ja") {
      await page.goto(`/races/${RACE_DATE}`);
    } else {
      await rewriteTodayRaces(page, (venues) => ensureOpenVenues(venues, 1));
      await page.goto(homePath);
    }
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    const racePath = new URL(page.url()).pathname;
    expect(racePath.startsWith(localizePath("/race/", lang))).toBe(true);
    expect(racePath).toMatch(/\/race\/\d{4}-\d{2}-\d{2}-/);
    if (lang === "ja") expect(racePath).toContain(`/race/${RACE_DATE}-`);
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
    const leftValues = await leftPageSocialValues(page);
    await page.locator(`.breadcrumb a[href="${homePath}"]`).click();
    await expect(page).toHaveURL(homePath);
    const defaultsBySelector = Object.fromEntries(
      socialSelectors.map((selector, index) => [selector, defaults[index]]),
    );
    await expect
      .poll(() => homeSocialProblems(page, defaultsBySelector, racePath, leftValues))
      .toEqual([]);
  });
}
