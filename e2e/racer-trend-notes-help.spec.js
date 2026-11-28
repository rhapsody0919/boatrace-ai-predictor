import { test, expect } from "./fixtures.js";

// 選手ページの展示・ST の推移は、図の上に凡例の1行と「?」だけを出し、読み方は「?」の中へ（plan.md §14、オーナー 2026-11-28）
test.describe("選手ページの推移の注記（読み方は「?」へ）", () => {
  test.slow();

  test("375px: 展示と ST の推移は注記が1行で、「?」に読み方の説明が出る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/racer/4069");
    const chartOf = (name) =>
      page.locator(".racer-stat-chart").filter({
        has: page.locator("h3", { hasText: name }),
      });
    const st = chartOf("STの推移");
    await expect(st).toBeVisible({ timeout: 30000 });
    await expect(st.locator(".racer-stat-note")).toHaveCount(1);
    await expect(st.locator(".racer-stat-note")).toHaveText(
      /^点線は条件の全走の平均（Fの走を除く）\?$/,
    );
    await st.locator(".term-hint__button").click();
    await expect(page.locator(".term-hint__popover")).toContainText(
      "フライングの走は線に含めず",
    );
    await st.locator(".term-hint__button").click();

    const ex = chartOf("展示タイムの推移");
    await expect(ex.locator(".racer-stat-note")).toHaveCount(1);
    await expect(ex.locator(".racer-stat-note")).toHaveText(
      /^点線は条件の全走の平均\?$/,
    );
    await ex.locator(".term-hint__button").click();
    await expect(page.locator(".term-hint__popover")).toContainText(
      "会場をまたいだ上下は調子の変化とは限りません",
    );
  });
});
