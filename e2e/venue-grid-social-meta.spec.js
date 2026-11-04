import { test, expect, e2eTodayJST } from "./fixtures.js";

const socialSelectors = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
];

async function expectPageSocialMeta(page, canonical) {
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    canonical,
  );
  const title = await page.title();
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(title).toBeTruthy();
  expect(description).toBeTruthy();
  for (const selector of socialSelectors.slice(0, 2)) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute("content", title);
  }
  for (const selector of socialSelectors.slice(2, 4)) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute("content", description);
  }
  const ogUrl = page.locator('meta[property="og:url"]');
  await expect(ogUrl).toHaveCount(1);
  await expect(ogUrl).toHaveAttribute("content", canonical);
}

for (const daily of [false, true]) {
  test(`${daily ? "日別一覧" : "トップ"}のカードはページメタに一致し、離れると既定に戻る`, async ({
    page,
  }) => {
    // useSocialMeta を使わない日付一覧で index.html の既定値を採る。
    await page.goto("/races");
    await expect(page.locator(".race-history-page")).toBeVisible();
    const defaults = await Promise.all(
      socialSelectors.map((selector) =>
        page.locator(selector).getAttribute("content"),
      ),
    );
    const date = e2eTodayJST();
    const path = daily ? `/races/${date}` : "/";
    await page.goto(path);
    await expect(page).toHaveTitle(
      daily ? /のAI予想データ - 龍神レーダー$/ : /龍神レーダー/,
    );
    if (daily) {
      const [year, month, day] = date.split("-").map(Number);
      await expect(page).toHaveTitle(
        new RegExp(`^${year}年${month}月${day}日\\([日月火水木金土]\\)のAI予想データ - 龍神レーダー$`),
      );
    }
    await expectPageSocialMeta(page, `https://www.boat-ai.jp${path}`);
    for (let index = 4; index < socialSelectors.length; index += 1) {
      await expect(page.locator(socialSelectors[index])).toHaveAttribute(
        "content",
        defaults[index],
      );
    }

    // SPA 遷移でアンマウントし、復元と og:url の削除を検査する。
    if (!daily) await page.locator(".app-header .menu-btn").click();
    const link = daily
      ? page.locator(".page-header .back-link")
      : page.locator('.app-header a[href="/races"]').first();
    await link.click();
    await expect(page).toHaveURL("/races");
    await expect(page.locator(".race-history-page")).toBeVisible();
    for (let index = 0; index < socialSelectors.length; index += 1) {
      await expect(page.locator(socialSelectors[index])).toHaveAttribute(
        "content",
        defaults[index],
      );
    }
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  });
}
