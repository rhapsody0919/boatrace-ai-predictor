import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
import { homeSocialProblems, leftPageSocialValues } from "./home-social-meta.js";

const DESCRIPTION = "支部・身長・体重・級別・登録期・出身地で絞り込み、勝率などでソートできる選手一覧。";
const defaultHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const socialSelectors = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
];

for (const pageNumber of [1, 2]) {
  const path = pageNumber === 1 ? "/racers" : "/racers?page=2";
  const canonicalUrl = `https://www.boat-ai.jp${path}`;
  const expectedTitle = pageNumber === 1
    ? "選手一覧 | 龍神レーダー"
    : "選手一覧（2ページ目）| 龍神レーダー";

  test(`${path}: OGP・Xカードの一致と遷移後の復元`, async ({ page }) => {
    // index.html の静的値を保存し、フックの既定値復元と画像の維持を検査する。
    const defaults = await page.evaluate(({ html, selectors }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return selectors.map((selector) => [selector, doc.querySelector(selector).content]);
    }, { html: defaultHtml, selectors: socialSelectors });
    const assertSocialMeta = async () => {
      await expect(page).toHaveTitle(expectedTitle);
      const title = await page.title();
      const description = page.locator('meta[name="description"]');
      await expect(description).toHaveCount(1);
      await expect(description).toHaveAttribute(
        "content",
        DESCRIPTION,
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
    for (const [selector, content] of defaults.filter(([selector]) => selector.includes("image"))) {
      await expect(page.locator(selector)).toHaveAttribute("content", content);
    }
    // 再読込せず Router で移動して、アンマウント時の後片付けを確認する。
    const leftValues = await leftPageSocialValues(page);
    await page.locator("header .logo").click();
    await expect(page).toHaveURL("/");
    await expect
      .poll(() => homeSocialProblems(page, Object.fromEntries(defaults), path, leftValues))
      .toEqual([]);
  });
}
