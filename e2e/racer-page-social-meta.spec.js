import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";

const defaultHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const socialSelectors = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
];

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
  // index.html の静的値（トップが自分の OGP を出す前の姿）を既定値として読む。
  const defaults = await page.evaluate(({ html, selectors }) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Object.fromEntries(selectors.map((selector) => [selector, doc.querySelector(selector).content]));
  }, { html: defaultHtml, selectors: socialSelectors });
  await openRacer(page);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", await page.title());
  // ページを再読込せず React Router で遷移して、フックの後片付けを確かめる。
  await page.locator('.racer-profile-breadcrumb a[href="/"]').click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(() => homeSocialProblems(page, defaults, "/racer/3941"))
    .toEqual([]);
});
