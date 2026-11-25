import { test, expect } from "./fixtures.js";

/**
 * 選手ページの、絞り込みが効く節の枠（UI/UX 改善 #6、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * 絞り込みの欄と、それが効く節は1つの枠の中。公式成績・モーター・全体の成績・条件別の成績は枠の外。
 * 枠・成績・レース一覧には、ページ内の目次の飛び先の id が付く。録画の再生で 4320、375 と 1440
 */
for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}px: 絞り込みの欄と効く節は枠の中、効かない節は枠の外`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/racer/4320");
    const frame = page.locator("section.racer-filter-scope");
    await expect(frame).toBeVisible({ timeout: 40000 });
    await expect(frame).toHaveAttribute("id", "racer-filtered");
    await expect(frame.locator(".racer-filter-scope__title")).toHaveText(
      "この枠の中は絞り込みが効きます",
    );
    await expect(frame.locator(".racer-vc-filter")).toHaveCount(1);
    await expect(frame.locator("h3", { hasText: "決まり手傾向" })).toHaveCount(1);
    await expect(frame.locator("#racer-race-list")).toHaveCount(1);
    await expect(page.locator("#racer-stats")).toHaveCount(1);
    await expect(
      page.locator(
        ".racer-filter-scope .racer-official-block, .racer-filter-scope .racer-motor-status-card, .racer-filter-scope .racer-cond-stats, .racer-filter-scope .racer-stat-cards-grid:not(.racer-vc-cards-grid)",
      ),
    ).toHaveCount(0);
    // 枠の前に、絞り込みに連動しない節（条件別の成績）がある。条件別の成績は非同期に届くので、出るのを待ってから比べる
    // （本番のデータの E2E Live では届く前に比べて null で落ちていた。2026-11-25）
    await expect(page.locator(".racer-cond-stats")).toBeVisible({ timeout: 40000 });
    const order = await page.evaluate(() => {
      const y = (q) => document.querySelector(q).getBoundingClientRect().top;
      return y(".racer-cond-stats") < y(".racer-filter-scope");
    });
    expect(order).toBe(true);
  });
}

// 全会場の会場別・枠番別の表はグレード・レース種別で集計し直していない。枠の中で「絞り込みが効きます」と言うので、
// 選んでいる間は出さず理由を1行（効かない値を同じ顔で並べない。ファン評価 #3279 1周 P1）
test("グレードを選ぶと、絞り込みの効かない会場別・枠番別の表を出さない", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/racer/4320");
  const frame = page.locator("section.racer-filter-scope");
  await expect(frame.locator("h3", { hasText: "会場名をクリックで絞り込み" })).toHaveCount(1, { timeout: 40000 });
  await page.locator("#vc-grade").selectOption({ index: 1 });
  await expect(frame.getByTestId("racer-overview-hidden")).toBeVisible();
  await expect(frame.locator("h3", { hasText: "会場名をクリックで絞り込み" })).toHaveCount(0);
  await page.locator("#vc-grade").selectOption("all");
  await expect(frame.getByTestId("racer-overview-hidden")).toHaveCount(0);
  await expect(frame.locator("h3", { hasText: "会場名をクリックで絞り込み" })).toHaveCount(1);
});
