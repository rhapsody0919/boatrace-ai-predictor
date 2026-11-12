import { test, expect } from "@playwright/test";
import { internalApiHeaders } from "../../api/_lib/internalApiHeaders.js";

// 配備先（本番）の Vercel の設定・middleware・api/ の今の版を、外から読むだけで確かめる（ZB02、BOA-1497）。
// e2e-live は master を手元でビルドして localhost で開くので、ここに並べた物は e2e-live では見えない。
// 期待の正本: vercel.json（headers・redirects・rewrites）、middleware.js（Basic 認証・ボット向けの rewrite・/api の関門）

const HTML_NO_STORE = "no-cache, no-store, must-revalidate, s-maxage=0";

test.describe("vercel.json（配備の設定）", () => {
  test("トップは SPA の HTML を no-store・nosniff で返し、束の JS は immutable で取れる", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    expect(res.headers()["cache-control"]).toBe(HTML_NO_STORE);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const html = await res.text();
    expect(html).toContain('id="root"');
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    expect(asset, "index.html に /assets/*.js の束が無い").toBeTruthy();
    const js = await request.get(asset);
    expect(js.status()).toBe(200);
    expect(js.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("SPA の道（/venue/1）は index.html へ rewrite される", async ({ request }) => {
    const res = await request.get("/venue/1");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  test("redirects: /outcome-distribution は 308 で /winning-technique?tab=outcome へ", async ({ request }) => {
    const res = await request.get("/outcome-distribution", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers()["location"], "https://x").pathname + new URL(res.headers()["location"], "https://x").search).toBe(
      "/winning-technique?tab=outcome",
    );
  });
});

test.describe("middleware.js（配備の middleware）", () => {
  test("管理画面は認証なしで 401（fail-closed）", async ({ request }) => {
    const res = await request.get("/admin/rules", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test("AI クローラーの UA には静的な HTML（SPA の殻でない）を返す", async ({ request }) => {
    const res = await request.get("/", { headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" } });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('id="root"');
    expect(html).toContain("<title>");
  });

  test("/api の関門: 符号化した / は 400、ブラウザでも合言葉でもない要求は 403、合言葉つきは通る", async ({ request }) => {
    // 関門（api/_lib/apiGate.js の decideApiGate）は ブラウザの UA を通すので、拒まれる側はブラウザでない UA で送る
    const badPath = await request.get("/api/races%2Ftoday");
    expect(badPath.status()).toBe(400);
    const denied = await request.get("/api/races/today", { headers: { "user-agent": "curl/8.7.1" } });
    expect(denied.status()).toBe(403);
    const headers = internalApiHeaders("e2e-release", process.env);
    // 手元（鍵なし）だけ飛ばす。CI で鍵が無いのは secrets の設定の誤りなので、飛ばさず赤にする
    if (process.env.CI) expect(headers["x-ryujin-internal-key"], "CI に INTERNAL_API_KEY が無い").toBeTruthy();
    test.skip(!headers["x-ryujin-internal-key"], "INTERNAL_API_KEY が無い（手元）");
    const ok = await request.get("/api/races/today", { headers });
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("application/json");
    JSON.parse(await ok.text());
  });
});

test.describe("画面（配備の束）", () => {
  for (const path of ["/", "/today", "/venue/1"]) {
    test(`${path} が描け、ページの例外が出ない`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(200);
      await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      expect(errors, `ページの例外: ${errors.join(" / ")}`).toEqual([]);
    });
  }
});
