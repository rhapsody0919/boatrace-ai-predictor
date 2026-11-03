import { test, expect, e2eTodayJST } from "./fixtures.js";

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
  await page.goto("/");
  const card = page.locator("a.venue-grid-card--open").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const href = await card.getAttribute("href");
  const code = href.match(/\/venue\/(\d+)$/)?.[1];
  expect(code, `会場カードのリンクが /venue/:code ではない: ${href}`).toBeTruthy();
  const defaults = await socialContents(page);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);

  await page.goto(`/races/${e2eTodayJST()}/${code}`);
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
  expect(canonical).toBe(`https://www.boat-ai.jp/races/${e2eTodayJST()}/${Number(code)}`);
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
  await page.locator(".app-header .logo").click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".venue-race-list-page")).toHaveCount(0);
  await expect.poll(() => socialContents(page)).toEqual(defaults);
  await expect(ogUrl).toHaveCount(0);
});
