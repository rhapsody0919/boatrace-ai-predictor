import { test, expect } from "./fixtures.js";

test.use({ viewport: { width: 375, height: 812 } });

for (const [lang, expected] of [["ko", "keep-all"], ["ja", "normal"]]) {
  test(`${lang}: 今節の折り返しは ${expected}`, async ({ page }) => {
    await page.goto(`${lang === "ko" ? "/ko" : ""}/race/2026-09-23-09-12`);
    await page.locator(".race-tabs-btn").nth(3).click();
    const tab = page.locator(".race-meet-tab");
    await expect(tab).toBeVisible();
    await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6);
    await expect(tab).toHaveCSS("word-break", expected);
  });
}

test("ko: 基本情報のF凡例は語の境目で折り返す", async ({ page }) => {
  await page.goto("/ko/race/2026-09-25-01-07");
  await page.locator(".race-tabs-btn", { hasText: "기본 정보" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6);
  const legend = page.locator(".rbit-note", { hasText: "이번 시리즈" });
  await expect(legend).toBeVisible();
  await expect(legend).toHaveCSS("word-break", "keep-all");
});
