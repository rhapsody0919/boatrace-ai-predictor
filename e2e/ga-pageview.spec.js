import { test, expect } from "./fixtures.js";

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

  test("管理画面（/admin）は直接開いてもSPA遷移でも計測しない", async ({
    page,
  }) => {
    // /admin/rules は表示時に 2026-01-16 以降の predictions を1000件ずつ全件ページングする
    // （ruleMatchService・adminRuleService。3系統が並行し、1万件超）。このテストが見るのは
    // GA の送信だけでデータは要らない。取らせると 1.5 秒の待機中に途中まで進んで打ち切られ、
    // 録画に入らない後半のページが毎回本番へ素通しする（BOA-551）ため、空で返す。
    // page.route の fulfill は context の録画・再生より先に評価されるので録画も汚さない
    const PREDICTIONS = /\/rest\/v1\/predictions\?/;
    const emptyPredictions = (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    await page.route(PREDICTIONS, emptyPredictions);
    await page.goto("/admin/rules");
    await page.waitForTimeout(1500);
    expect(await pageViews(page)).toHaveLength(0);
    await page.unroute(PREDICTIONS, emptyPredictions);

    // 公開ページから SPA 遷移で入った場合も送らない（旧実装は config で送っていた）
    await page.goto("/");
    await expect.poll(() => pageViews(page).then((v) => v.length)).toBe(1);
    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/sns-hub");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\/sns-hub$/);
    await page.waitForTimeout(1500);
    const adminCalls = await page.evaluate(() =>
      window.__gaCalls.filter((args) =>
        JSON.stringify(args).includes("/admin"),
      ),
    );
    expect(adminCalls).toHaveLength(0);
  });
});
