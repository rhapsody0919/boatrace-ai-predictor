import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";

// 他ページからトップへ戻った後の OGP の問題点を返す（空なら合格）。
// トップが自分の OGP を出す前（index.html の既定のまま・og:url なし）と後（title・description・canonical に合わせる）のどちらでも通す。
// 直前のページの値（title・description・URL）が残っていれば、どちらの状態でも問題として返す。
async function homeSocialProblems(page, defaults, leftPath) {
  return page.evaluate(
    ({ defaults, leftPath }) => {
      const contents = (selector) =>
        Array.from(document.querySelectorAll(selector)).map((el) => el.getAttribute("content"));
      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content");
      const problems = [];
      for (const [selector, fallback] of Object.entries(defaults)) {
        const values = contents(selector);
        if (values.length !== 1) {
          problems.push(`${selector}: ${values.length}件`);
          continue;
        }
        const allowed = selector.includes("title")
          ? [fallback, document.title]
          : selector.includes("description")
            ? [fallback, metaDescription]
            : [fallback];
        if (!allowed.includes(values[0])) problems.push(`${selector}: 既定値でも現ページの値でもない (${values[0]})`);
      }
      const ogUrls = contents('meta[property="og:url"]');
      if (ogUrls.length > 1) problems.push(`og:url: ${ogUrls.length}件`);
      if (ogUrls.length === 1) {
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
        if (ogUrls[0] !== canonical) problems.push(`og:url が canonical と違う (${ogUrls[0]} / ${canonical})`);
        if (leftPath && ogUrls[0]?.includes(leftPath)) problems.push(`og:url に直前のページの URL が残っている (${ogUrls[0]})`);
      }
      return problems;
    },
    { defaults, leftPath },
  );
}

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
    await page.locator("header .logo").click();
    await expect(page).toHaveURL("/");
    await expect
      .poll(() => homeSocialProblems(page, Object.fromEntries(defaults), path))
      .toEqual([]);
  });
}
