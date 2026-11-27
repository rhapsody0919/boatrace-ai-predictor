import { test, expect } from "./fixtures.js";
import { injectPageHead, pastVenuePageHead } from "../src/pure/pageHead.js";

// 生の HTML に差し込んだ head（middleware と同じ純関数で外枠に入れる）を、起動の後に React の head へ受け渡すこと。
// 1. JS を回さないと、差し込みの title・canonical・description・BreadcrumbList が1つずつ見える
// 2. 描画の後も canonical・description・BreadcrumbList が1本ずつで、canonical が現れた後に0本の瞬間が無い
// 3. 別のパスへ移ると差し込みは残らず、title の要素（useSingleTitle が掴む物）の文は既定に戻る
// 材料の取得（/api・/rest/v1）は止める（本番へ出さない。head の受け渡しはデータに依らない）
test.use({ viewport: { width: 375, height: 812 } });

const PATH = "/races/2026-10-01/1";
const CANONICAL = "https://www.boat-ai.jp/races/2026-10-01/1";

async function serveInjectedShell(page, baseURL) {
  let defaultTitle = null;
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/rest/v1/**", (route) => route.abort());
  await page.route(
    (url) => new URL(url).pathname === PATH,
    async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      // 外枠は手元の vite が返す index.html（配備と同じ形）。録画の外の手元の画面なので、試験の側から取る
      const shell = await (await fetch(new URL(PATH, baseURL))).text();
      defaultTitle = shell.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
      const body = injectPageHead(
        shell,
        pastVenuePageHead({ date: "2026-10-01", venueCode: 1, venueName: "桐生", homeName: "ホーム" }),
      );
      expect(body, "外枠に差し込めない").not.toBeNull();
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
    },
  );
  return () => defaultTitle;
}

const headCounts = (page) =>
  page.evaluate(() => ({
    canonical: document.querySelectorAll('link[rel="canonical"]').length,
    description: document.querySelectorAll('meta[name="description"]').length,
    breadcrumb: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).filter(
      (el) => el.textContent.includes('"BreadcrumbList"'),
    ).length,
    injected: document.querySelectorAll("[data-page-head]").length,
    titles: Array.from(document.querySelectorAll("title")).filter((el) => !el.closest("svg")).length,
  }));

test.describe("生の head の受け渡し", () => {
  test("JS の前は差し込みの head が1本ずつ", async ({ browser, baseURL }) => {
    // JS を回さない取得器と同じ見え方（生の HTML の head だけ）
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      await serveInjectedShell(page, baseURL);
      await page.goto(PATH);
      expect(await headCounts(page)).toEqual({ canonical: 1, description: 1, breadcrumb: 1, injected: 4, titles: 1 });
      expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(CANONICAL);
      expect(await page.title()).toContain("桐生競艇の結果・配当");
    } finally {
      await context.close();
    }
  });

  test("描画の後は React の head が1本ずつで、canonical が0本の瞬間が無い", async ({ page, baseURL }) => {
    await serveInjectedShell(page, baseURL);
    // 最初に canonical が現れた後の数の推移を記録する（HTML を読む途中の0は数えない）
    await page.addInitScript(() => {
      window.__canonicalCounts = [];
      const count = () => document.querySelectorAll('link[rel="canonical"]').length;
      new MutationObserver(() => {
        const n = count();
        if (window.__canonicalCounts.length > 0 || n > 0) window.__canonicalCounts.push(n);
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(PATH);
    await expect(page.locator(".breadcrumb-list")).toBeVisible();
    await expect
      .poll(() => headCounts(page))
      .toEqual({ canonical: 1, description: 1, breadcrumb: 1, injected: 0, titles: 1 });
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(CANONICAL);
    const counts = await page.evaluate(() => window.__canonicalCounts);
    expect(counts.length, "canonical の出入りを記録できていない").toBeGreaterThan(0);
    expect(Math.min(...counts), `canonical の数の推移 ${counts.join(",")}`).toBeGreaterThanOrEqual(1);
  });

  test("別のパスへ移ると差し込みが残らず、title の文は既定に戻る", async ({ page, baseURL }) => {
    const defaultTitleOf = await serveInjectedShell(page, baseURL);
    await page.addInitScript(() => {
      new MutationObserver((_records, observer) => {
        const title = document.querySelector("title");
        if (title) {
          window.__staticTitle = title;
          observer.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(PATH);
    await expect(page.locator(".breadcrumb-list")).toBeVisible();

    await page.locator('.breadcrumb-list a[href="/races/2026-10-01"]').click();
    await expect(page).toHaveURL(/\/races\/2026-10-01$/);
    await expect.poll(() => headCounts(page)).toMatchObject({ injected: 0, titles: 1, canonical: 1 });
    const staticTitle = await page.evaluate(() => ({
      text: window.__staticTitle.textContent,
      marked: window.__staticTitle.hasAttribute("data-page-head"),
    }));
    expect(staticTitle).toEqual({ text: defaultTitleOf(), marked: false });
    expect(await page.title()).not.toContain("桐生競艇の結果・配当");
  });
});
