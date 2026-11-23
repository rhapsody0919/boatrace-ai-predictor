import { test, expect } from "./fixtures.js";

// 分析ツールのタブを5つの組の2段にした（#3258 の #4）。20個を平らに並べると 375px でタブだけで
// 1画面目が埋まり、本文が y≈835 から始まっていた（2026-11-23 の本番の撮影）。
test.describe("分析ツールのタブの組", () => {
  test("組のチップで組の最初のタブへ移り、20個のタブはどれも押せる", async ({ page }) => {
    await page.goto("/winning-technique?tab=technique");
    const chips = page.locator(".analysis-group-chip");
    await expect(chips).toHaveText(["会場の傾向", "モーター", "選手", "スタート・展示", "レースと実績"]);
    await expect(chips.filter({ hasText: "会場の傾向" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".analysis-tab-btn")).toHaveCount(20);

    await chips.filter({ hasText: "モーター" }).click();
    await expect(page).toHaveURL(/[?&]tab=motor(&|$)/);
    await expect(page.locator(".analysis-tab-btn.active")).toContainText("モーター調子");
    await expect(chips.filter({ hasText: "モーター" })).toHaveAttribute("aria-pressed", "true");
    // 組の外のタブを直接押すと、チップもその組に移る
    await page.locator(".analysis-tab-btn", { hasText: "STのズレ" }).click();
    await expect(chips.filter({ hasText: "スタート・展示" })).toHaveAttribute("aria-pressed", "true");
  });

  test("375px でタブの2段が1画面目の上に収まる", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/winning-technique?tab=technique");
    const box = await page.locator(".analysis-tabs").boundingBox();
    expect(box).not.toBeNull();
    expect(box.y + box.height).toBeLessThan(360);
    // ページ全体は横にはみ出さない（タブの行の中だけが横に流れる）
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("375px で ?tab= の組が右端でも、選んだ組のチップとタブが行の中に見える", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/winning-technique?tab=volatility");
    for (const sel of [".analysis-group-chip.active", ".analysis-tab-btn.active"]) {
      const row = await page.locator(sel).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const p = el.parentElement.getBoundingClientRect();
        return { left: r.left - p.left, right: p.right - r.right };
      });
      expect(row.left, sel).toBeGreaterThanOrEqual(-1);
      expect(row.right, sel).toBeGreaterThanOrEqual(-1);
    }
  });
});
