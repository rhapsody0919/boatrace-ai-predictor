import { test, expect } from "@playwright/test";

// GA4 の page_view が1ルート1回・正しい page_location で送られることを固定する（BOA-531）。
// 開発サーバーでは initGA が gtag を読み込まないため、window.gtag を差し替えて
// アプリが送ろうとした呼び出しを記録する。
// 以前は (1) SPA遷移を gtag('config') の再送で送ろうとしていたが GA4 はこれを送信しない、
// (2) App.jsx が同意なしで GA を二重初期化し、タブごとに page_view を追加送信していた、
// (3) /admin も計測していた。
test.describe("GA4 page_view の送信経路", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("boatai:cookie-consent", "accepted");
      window.__gaCalls = [];
      window.gtag = (...args) => window.__gaCalls.push(args);
    });
  });

  const pageViews = (page) =>
    page.evaluate(() =>
      window.__gaCalls
        .filter(([cmd, name]) => cmd === "event" && name === "page_view")
        .map(([, , params]) => params),
    );

  const configCalls = (page) =>
    page.evaluate(() => window.__gaCalls.filter(([cmd]) => cmd === "config"));

  test("初回表示とSPA遷移で1回ずつ、page_location を明示して送る", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await expect.poll(() => pageViews(page).then((v) => v.length)).toBe(1);
    expect((await pageViews(page))[0].page_location).toBe(`${baseURL}/`);

    await page.locator("a.blog-preview-btn").click();
    await expect(page).toHaveURL(/\/blog$/);
    await expect.poll(() => pageViews(page).then((v) => v.length)).toBe(2);
    const [, second] = await pageViews(page);
    expect(second.page_location).toBe(`${baseURL}/blog`);
    expect(second.page_referrer).toBe(`${baseURL}/`);

    // SPA遷移を config の再送で送らない（GA4 はこれを送信しないため）
    expect(await configCalls(page)).toHaveLength(0);
  });

  test("タブページ（/hit-races）でも page_view は1回だけ", async ({ page }) => {
    await page.goto("/hit-races");
    await expect.poll(() => pageViews(page).then((v) => v.length)).toBe(1);
    await page.waitForTimeout(1500);
    expect(await pageViews(page)).toHaveLength(1);
    expect(await configCalls(page)).toHaveLength(0);
  });

  test("URLのハッシュ（AdSense の #google_vignette 等）は page_location に含めない", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/#google_vignette");
    await expect.poll(() => pageViews(page).then((v) => v.length)).toBe(1);
    expect((await pageViews(page))[0].page_location).toBe(`${baseURL}/`);
  });

  test("管理画面（/admin）は計測しない", async ({ page }) => {
    await page.goto("/admin/rules");
    await page.waitForTimeout(1500);
    expect(await pageViews(page)).toHaveLength(0);
  });
});
