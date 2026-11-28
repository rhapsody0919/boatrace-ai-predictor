import { test, expect } from "./fixtures.js";

// 今節タブの選んだ艇の小さな図（ST・展示）は、判定の文字（踏んでいる・慎重）を出さず「差 −0.02」の値だけにし、
// 読み方は ST・展示の見出しの「?」へ（plan.md §14、オーナー 2026-11-28）
test.describe("今節の小さな図の注記（読み方は「?」へ）", () => {
  test.slow();

  test("375px: ST の差は値だけで1行、注記の段落は無く、両方の見出しの「?」に読み方が出る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/race/2026-09-28-09-11");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const box = page.locator(".rmt-sparks");
    await expect(box.locator(".rmt-spark").first()).toBeVisible({
      timeout: 30000,
    });
    const diff = box.locator(".rmt-verdict");
    await expect(diff).toHaveText(/^差 (−|\+)?\d\.\d{2}$/);
    // 札ごと1行（差の数字だけが次の行へ落ちない）
    expect(
      await diff.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getClientRects().length;
      }),
    ).toBe(1);
    await expect(box).not.toContainText("踏んでいる");
    await expect(box).not.toContainText("慎重");
    await expect(box.locator(".rmt-spark-note")).toHaveCount(0);
    const hints = box.locator(".rmt-spark-title .term-hint__button");
    await expect(hints).toHaveCount(2);
    await hints.nth(1).click();
    await expect(page.locator(".term-hint__popover")).toContainText(
      "−を緑、+を赤にします",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
