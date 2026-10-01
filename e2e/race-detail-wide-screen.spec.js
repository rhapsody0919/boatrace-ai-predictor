import { test, expect } from "./fixtures.js";

// BOA-612: レース詳細を 1600px まで広げる。6艇を列に並べる表は広く使い、
// 1行に1艇を並べるリスト・グラフは読みやすい幅（1200px）で止める
test.describe("レース詳細の広い画面（BOA-612）", () => {
  test.slow();

  test("1920px: 6艇の表は1600pxの枠いっぱい、リストとグラフは1200pxで止まり、表の文字がそろう", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    // 児島 2026-09-29 12R（予選2日目。今節タブに得点率早見が出る）
    await page.goto("/race/2026-09-29-16-12");
    await expect(page.locator(".drt-table").first()).toBeVisible({
      timeout: 30000,
    });
    const width = (sel) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => el.getBoundingClientRect().width);
    const fontSize = (sel) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    expect(await width(".race-detail-page-v2")).toBe(1600);
    // 6艇の列を持つ表は、以前（1118px）より広い
    expect(await width(".drt-table")).toBeGreaterThan(1400);
    // 1行に1艇のバーは 1200px で止める（名前と数値が離れすぎない。ファン評価1周目）
    expect(await width(".rbit-bars")).toBeLessThanOrEqual(1200);
    // 行見出し・補足行も数値に合わせて大きくする（ファン評価1周目）
    expect(await fontSize(".drt-table td.drt-value, .drt-table .drt-cell")).toBe(15);
    expect(await fontSize(".drt-label-cell")).toBeGreaterThanOrEqual(14);
    expect(await fontSize(".drt-grade")).toBeGreaterThanOrEqual(13);

    // 今節タブ: リストと推移グラフは 1200px で止める（点が横に潰れない）、得点率早見は 13px
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".race-meet-tab")).toBeVisible({ timeout: 30000 });
    expect(await width(".race-meet-tab")).toBeLessThanOrEqual(1200);
    await expect(page.locator(".rmt-forecast-table")).toBeVisible({
      timeout: 30000,
    });
    expect(await fontSize(".rmt-forecast-table")).toBeGreaterThanOrEqual(13);

    // ページ全体は横スクロールしない
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
