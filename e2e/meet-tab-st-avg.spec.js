import { test, expect } from "./fixtures.js";

test.use({ viewport: { width: 375, height: 844 } });

test("前走Fの値に平均の文字を混ぜない", async ({ page }) => {
  await page.goto("/race/2026-09-30-04-11");
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  const row = page.locator(".rmt-trend-row").filter({ hasText: "古川" });
  await expect(row.locator(".rmt-trend-last")).toHaveText("F", { timeout: 30000 });
  await expect(row.locator(":scope > .rmt-trend-st-avg")).toContainText("平均");
});
