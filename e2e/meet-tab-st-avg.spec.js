import { test, expect } from "./fixtures.js";

test.use({ viewport: { width: 375, height: 844 } });

test("今節のSTだけに平均・順位を控えめに表示し375pxで折り返さない", async ({ page }) => {
  await page.goto("/race/2026-09-28-09-11");
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  const card = page.locator(".rmt-card").filter({ has: page.locator(".rmt-trend-rows") });
  await expect(card.locator(".rmt-trend-row")).toHaveCount(6, { timeout: 30000 });
  await card.getByRole("button", { name: "ST", exact: true }).click();
  const summaries = card.locator(".rmt-trend-st-avg");
  await expect(summaries).toHaveCount(6);
  await expect(card.locator(".rmt-trend-st-avg-note")).toContainText("未検証");
  await expect(card.locator(".rmt-trend-last .rmt-trend-st-avg")).toHaveCount(0);
  await expect(card.locator(".rmt-trend-row > .rmt-trend-st-avg")).toHaveCount(6);
  await expect(card.locator(".rmt-trend-st-avg-note")).not.toHaveClass(/rmt-spark-note/);
  await expect(card.locator(".rmt-spark-note").first()).toContainText("点の下の数字はその走の着順です");
  const chartBounds = () => card.locator(".rmt-trend-row svg").evaluateAll((els) =>
    els.map((el) => {
      const { left, right } = el.getBoundingClientRect();
      return { left, right };
    }));
  const stBounds = await chartBounds();
  expect(await card.locator(".rmt-trend-row").evaluateAll((rows) => rows.every((row) => {
    const labels = [...row.querySelectorAll(".meet-sparkline-label")]
      .map((el) => el.getBoundingClientRect());
    return labels.every((box, i) => labels.slice(0, i).every((other) =>
      box.left >= other.right || box.right <= other.left ||
      box.top >= other.bottom || box.bottom <= other.top));
  }))).toBe(true);
  for (const summary of await summaries.all()) {
    await expect(summary).toHaveText(/^(平均\d+\.\d{2}・[1-6]位（\d+走）|[0-2]走のため出さない)$/);
    expect(await summary.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = el.getBoundingClientRect();
      return range.getClientRects().length === 1 && el.scrollWidth <= el.clientWidth &&
        box.right <= window.innerWidth;
    })).toBe(true);
  }
  const ends = await card.locator(".rmt-trend-row svg").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().right));
  expect(ends).toHaveLength(6);
  expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole("button", { name: "展示", exact: true }).click();
  await expect(summaries).toHaveCount(0);
  expect(await chartBounds()).toEqual(stBounds);
  await expect(card.locator(".rmt-trend-st-avg-note")).toHaveCount(0);
});

test("前走Fの値に平均の文字を混ぜない", async ({ page }) => {
  await page.goto("/race/2026-09-30-04-11");
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  const row = page.locator(".rmt-trend-row").filter({ hasText: "古川" });
  await expect(row.locator(".rmt-trend-last")).toHaveText("F", { timeout: 30000 });
  await expect(row.locator(":scope > .rmt-trend-st-avg")).toContainText("平均");
});
