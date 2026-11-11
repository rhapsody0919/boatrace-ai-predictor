import { test, expect } from "./fixtures.js";
import { homeSocialProblems, leftPageSocialValues } from "./home-social-meta.js";

// all-pages-layout の PAGES と同じ固定の過去日
const RACE_DATE = "2026-08-11";

const socialSelectors = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
];

async function socialContents(page) {
  return Promise.all(
    socialSelectors.map((selector) =>
      page.locator(selector).getAttribute("content"),
    ),
  );
}

test("日別会場一覧のカードはページメタに一致し、離れると既定に戻る", async ({
  page,
}) => {
  // 会場は固定の過去日の一覧から選ぶ（今日の開催中の会場は 0:00〜7:00 JST に無い）
  await page.goto(`/races/${RACE_DATE}`);
  const card = page.locator("a.venue-grid-card--open").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const href = await card.getAttribute("href");
  const code = href.match(/\/races\/\d{4}-\d{2}-\d{2}\/(\d+)$/)?.[1];
  expect(code, `会場カードのリンクが /races/:date/:code ではない: ${href}`).toBeTruthy();
  await page.goto("/");
  const defaults = await socialContents(page);
  const defaultsBySelector = Object.fromEntries(
    socialSelectors.map((selector, index) => [selector, defaults[index]]),
  );
  await expect.poll(() => homeSocialProblems(page, defaultsBySelector, null)).toEqual([]);
  const racesPath = `/races/${RACE_DATE}/${code}`;

  await page.goto(racesPath);
  await expect(page.locator(".venue-race-list-page h1")).toBeVisible();
  await expect(page).toHaveTitle(/のレース一覧・AIデータ分析 - 龍神レーダー$/);
  const title = await page.title();
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(description).toBeTruthy();
  expect(canonical).toBe(`https://www.boat-ai.jp/races/${RACE_DATE}/${Number(code)}`);
  for (const selector of socialSelectors.slice(0, 2)) {
    await expect(page.locator(selector)).toHaveAttribute("content", title);
  }
  for (const selector of socialSelectors.slice(2, 4)) {
    await expect(page.locator(selector)).toHaveAttribute("content", description);
  }
  const ogUrl = page.locator('meta[property="og:url"]');
  await expect(ogUrl).toHaveCount(1);
  await expect(ogUrl).toHaveAttribute("content", canonical);
  for (let index = 4; index < socialSelectors.length; index += 1) {
    await expect(page.locator(socialSelectors[index])).toHaveAttribute(
      "content",
      defaults[index],
    );
  }

  // フルリロードせず離れ、フックのアンマウントによる復元を検査する。
  const leftValues = await leftPageSocialValues(page);
  await page.locator(".app-header .logo").click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".venue-race-list-page")).toHaveCount(0);
  await expect
    .poll(() => homeSocialProblems(page, defaultsBySelector, racesPath, leftValues))
    .toEqual([]);
});
