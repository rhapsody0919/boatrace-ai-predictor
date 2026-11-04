import { test, expect, e2eTodayJST } from "./fixtures.js";

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
  const defaultsBySelector = Object.fromEntries(
    socialSelectors.map((selector, index) => [selector, defaults[index]]),
  );
  const racesPath = `/races/${e2eTodayJST()}/${code}`;

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
  await expect
    .poll(() => homeSocialProblems(page, defaultsBySelector, racesPath))
    .toEqual([]);
});
