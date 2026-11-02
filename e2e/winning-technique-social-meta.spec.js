import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
import { localizePath } from "../src/config/languages.js";

for (const lang of ["ja", "en"]) {
  const { analysisPage } = JSON.parse(
    readFileSync(
      new URL(`../src/locales/${lang}/common.json`, import.meta.url),
      "utf8",
    ),
  );
  const path = localizePath("/winning-technique", lang);
  const canonicalUrl = `https://www.boat-ai.jp${path}`;

  test(`${path}: OGP・Xカードをページのメタとそろえる`, async ({ page }) => {
    const assertSocialMeta = async () => {
      await expect(page).toHaveTitle(analysisPage.meta.title);
      const title = await page.title();
      const description = page.locator('meta[name="description"]');
      await expect(description).toHaveCount(1);
      await expect(description).toHaveAttribute(
        "content",
        analysisPage.meta.description,
      );
      const descriptionContent = await description.getAttribute("content");

      for (const selector of [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) {
        await expect(page.locator(selector)).toHaveCount(1);
        await expect(page.locator(selector)).toHaveAttribute("content", title);
      }
      for (const selector of [
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
      ]) {
        await expect(page.locator(selector)).toHaveCount(1);
        await expect(page.locator(selector)).toHaveAttribute(
          "content",
          descriptionContent,
        );
      }
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      await expect(canonical).toHaveAttribute("href", canonicalUrl);
      const ogUrl = page.locator('meta[property="og:url"]');
      await expect(ogUrl).toHaveCount(1);
      await expect(ogUrl).toHaveAttribute(
        "content",
        await canonical.getAttribute("href"),
      );
    };

    await page.goto(path);
    await assertSocialMeta();
    await page.locator(".analysis-tab-btn").nth(0).click();
    await expect(page).toHaveURL(`${path}?tab=outcome`);
    await assertSocialMeta();
    await page.locator(".analysis-tab-btn").nth(1).click();
    await expect(page).toHaveURL(`${path}?tab=technique`);
    await assertSocialMeta();
  });
}
