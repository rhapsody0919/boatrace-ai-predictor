import { test, expect } from "./fixtures.js";

/**
 * 会場×グレード分析の1着率（G4 T-09、VenueGradeWinShare）: グレードごとの1着の取り分の100%積み上げ棒。
 *   - グレードの行ごとにレース数（「Nレース」）を出す
 *   - 1つの棒の6つの区切りの幅の合計が棒の幅とほぼ同じ（1着率の合計が100%）
 *   - 棒の下の6艇の数字は「-」で隠さない（表だった頃は50レース未満を「-」にしていた）
 *   - 注記に集計の始まりの日（2026/2/4）
 *   - 375px で横にはみ出さない
 */
test.use({ viewport: { width: 375, height: 812 } });

test("会場×グレード: 1着率をグレードごとの積み上げ棒で出し、レース数と期間を出す", async ({
  page,
}) => {
  await page.goto("/winning-technique?tab=venuegrade");
  const rows = page.locator(".vgs .vgs-row:not(.vgs-legend)");
  await expect(rows.first()).toBeVisible({ timeout: 20000 });
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);

  for (let i = 0; i < n; i += 1) {
    const row = rows.nth(i);
    await expect(row.locator(".vgs-grade-count")).toHaveText(/^[\d,]+レース$/);
    const [bar, segs] = await row
      .locator(".vgs-bar")
      .evaluate((el) => [
        el.getBoundingClientRect().width,
        [...el.children].reduce(
          (s, c) => s + c.getBoundingClientRect().width,
          0,
        ),
      ]);
    expect(Math.abs(bar - segs)).toBeLessThan(bar * 0.03);
    const nums = await row.locator(".vgs-nums > span").allTextContents();
    expect(nums).toHaveLength(6);
    for (const t of nums) expect(t).toMatch(/^\d+\.\d$/);
  }
  await expect(page.locator(".vgs-note")).toContainText("2026/2/4");
  await expect(
    page.locator("#venue-grade-metric-select option[value=winRate]"),
  ).toHaveText("1着率");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
