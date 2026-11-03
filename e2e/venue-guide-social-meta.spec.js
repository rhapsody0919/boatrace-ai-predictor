import { test, expect } from "./fixtures.js";

const titleSelectors = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
];
const descriptionSelectors = [
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
];
const socialSelectors = [...titleSelectors, ...descriptionSelectors];

async function assertSocialMeta(page, path) {
  await expect(page).toHaveURL(path);
  await expect(page.locator(".eg-hero h1")).toBeVisible();
  await expect(page).toHaveTitle(/Boat Race.*Ryujin Radar/);
  const title = await page.title();
  const description = page.locator('meta[name="description"]');
  await expect(description).toHaveCount(1);
  await expect(description).toHaveAttribute("content", /\S/);
  for (const selector of titleSelectors) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute("content", title);
  }
  for (const selector of descriptionSelectors) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute(
      "content",
      await description.getAttribute("content"),
    );
  }
  const canonical = page.locator('link[rel="canonical"]');
  await expect(canonical).toHaveCount(1);
  await expect(canonical).toHaveAttribute("href", `https://www.boat-ai.jp${path}`);
  const ogUrl = page.locator('meta[property="og:url"]');
  await expect(ogUrl).toHaveCount(1);
  await expect(ogUrl).toHaveAttribute("content", await canonical.getAttribute("href"));
}

for (const path of ["/en/venues", "/en/venues/heiwajima"]) {
  test(`${path}: OGP・Xカードとcanonical、遷移と離脱時の復元`, async ({ page }) => {
    // フックを使わないガイドで既定値を保存する。
    await page.goto("/en/guide");
    await expect(page.locator(".eg-container h1")).toBeVisible();
    const defaults = await Promise.all(
      socialSelectors.map((selector) => page.locator(selector).getAttribute("content")),
    );
    await page.goto(path);
    await assertSocialMeta(page, path);

    // 再読込せず一覧・詳細を行き来して、og:url の重複と更新を検査する。
    if (path === "/en/venues") {
      await page.locator('.evg-card[href="/en/venues/heiwajima"]').click();
      await assertSocialMeta(page, "/en/venues/heiwajima");
    }
    await page.locator('.evg-breadcrumb a[href="/en/venues"]').click();
    await assertSocialMeta(page, "/en/venues");

    // React Router のリンクで離れ、アンマウント時の復元を検査する。
    await page.locator('.eg-hero a[href="/en/guide"]').click();
    await expect(page).toHaveURL("/en/guide");
    await expect(page.locator(".eg-container h1")).toBeVisible();
    for (const [index, selector] of socialSelectors.entries()) {
      await expect(page.locator(selector)).toHaveAttribute("content", defaults[index]);
    }
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  });
}
