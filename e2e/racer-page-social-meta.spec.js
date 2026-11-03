import { test, expect } from "./fixtures.js";

const DEFAULT_TITLE = "龍神レーダー - 無料のボートレースAI予想＆データ分析";

async function openRacer(page) {
  await page.goto("/racer/3941");
  await expect(page).toHaveTitle(/池田浩二/);
}

test("選手の OGP・X カードを title・description・canonical にそろえる", async ({ page }) => {
  await openRacer(page);
  const title = await page.title();
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toContain("池田浩二");
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    await expect(page.locator(selector)).toHaveAttribute("content", title);
  }
  for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    await expect(page.locator(selector)).toHaveAttribute("content", description);
  }
  const canonical = "https://www.boat-ai.jp/racer/3941";
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
});

test("トップへ移ると OGP の既定値に戻り、選手の URL を残さない", async ({ page }) => {
  await openRacer(page);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", await page.title());
  // ページを再読込せず React Router で遷移して、フックの後片付けを確かめる。
  await page.locator('.racer-profile-breadcrumb a[href="/"]').click();
  await expect(page).toHaveURL("/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", DEFAULT_TITLE);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
});
