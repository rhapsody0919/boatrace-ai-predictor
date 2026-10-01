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

    // 枠番別傾向の数値もデータ出走表と同じく大きくする（3周目: span 側の指定で効いていなかった）
    expect(await fontSize(".vtp-table .vtp-main")).toBeGreaterThanOrEqual(14);

    // 今節タブ: リストと推移グラフは 1200px で止める（点が横に潰れない）、得点率早見は 13px
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".race-meet-tab")).toBeVisible({ timeout: 30000 });
    expect(await width(".race-meet-tab")).toBeLessThanOrEqual(1200);
    await expect(page.locator(".rmt-forecast-table")).toBeVisible({
      timeout: 30000,
    });
    expect(await fontSize(".rmt-forecast-table")).toBeGreaterThanOrEqual(13);

    // 今節タブの小さい文字（10.4px）も一段上げる（2周目）
    expect(await fontSize(".rmt-compare th")).toBeGreaterThanOrEqual(12.5);

    // 枠別情報の1行1項目のリストも 1200px で止める（2周目で漏れを指摘）
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await expect(page.locator(".nsc-card")).toBeVisible({ timeout: 30000 });
    expect(await width(".nsc-card")).toBeLessThanOrEqual(1200);

    // オッズ一覧は表を広く使い、オッズの数字も大きくする（2周目）
    await page.locator(".race-tabs-btn", { hasText: "オッズ一覧" }).click();
    await expect(page.locator(".race-odds-list-tab").first()).toBeVisible({
      timeout: 30000,
    });
    const smallest = await page
      .locator(".race-odds-list-tab")
      .first()
      .evaluate((root) =>
        Math.min(
          ...[...root.querySelectorAll("*")]
            .filter((el) => el.children.length === 0 && el.textContent.trim())
            .map((el) => parseFloat(getComputedStyle(el).fontSize)),
        ),
      );
    expect(smallest).toBeGreaterThanOrEqual(12.5);

    // ページ全体は横スクロールしない
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test("1920px: 結果タブの着順・払戻は1200pxで止める（ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    // 戸田 2026-09-19 9R（録画の時刻でも結果が出ているレース）
    await page.goto("/race/2026-09-19-02-09");
    await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
    const result = page.locator(".race-result").first();
    await expect(result).toBeVisible({ timeout: 30000 });
    expect(
      await result.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(1200);
  });

  test("1440x900: 直前情報の展示情報の表は、最後の行まで内側で切れずに見える（ファン評価3周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/race/2026-09-29-16-12");
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    const wrapper = page.locator(".rbi-card .drt-table-wrapper").first();
    await expect(wrapper).toBeVisible({ timeout: 30000 });
    // 今節の一周・まわり足・直線まで、15行がそろってから測る（読み込み前は行が少ない）
    await expect(wrapper.locator("tbody tr")).toHaveCount(15, { timeout: 30000 });
    await page.waitForTimeout(1000);
    const m = await wrapper.evaluate((el) => ({
      sh: el.scrollHeight,
      ch: el.clientHeight,
    }));
    expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
  });
});
