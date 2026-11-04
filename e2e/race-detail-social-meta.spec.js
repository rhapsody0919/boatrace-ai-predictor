import { test, expect, e2eTodayJST } from "./fixtures.js";
import { localizePath } from "../src/config/languages.js";

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
    const defaultsBySelector = Object.fromEntries(
      socialSelectors.map((selector, index) => [selector, defaults[index]]),
    );
    await expect
      .poll(() => homeSocialProblems(page, defaultsBySelector, racePath))
      .toEqual([]);
  });
}
