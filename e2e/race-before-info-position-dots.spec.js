// 直前情報の展示の表で、色を付けない行に理由の札（事実のみ・1位だけ）を出し、印の付く行の6艇の位置を数直線で出す（行はボタンで切り替え）
// （見せ方の型3と札、意味づけ 2026-11-26 オーナー承認）。位置の札は艇の色のままで、左ほど速い。
import { test, expect } from "./fixtures.js";

// オリジナル展示（一周・まわり足・直線）がそろう録画のレース（race-before-info-tiers.spec.js と同じ）
const RACE = "/race/2026-09-29-16-12";

const labelCell = (table, label) =>
  table
    .locator("tbody tr")
    .locator(".drt-label-cell")
    .filter({ hasText: new RegExp(`^${label}`) })
    .first();

for (const width of [375, 1440]) {
  test(`色を付けない行に札、展示タイムの6艇の位置を左ほど速い順に出す ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: /^直前情報$/ }).click();
    const table = page.locator(".drt-table").first();
    await expect(table.locator("tbody tr")).toHaveCount(15, { timeout: 30000 });

    // 札: 事実（良し悪しなし）と、1位だけ（上位・下位の効き目は未確認）。印の付く行には札が無い
    for (const label of ["展示進入", "当日体重", "チルト", "調整重量", "部品交換"]) {
      await expect(labelCell(table, label).locator(".drt-row-note")).toHaveText("事実のみ");
    }
    for (const label of ["展示ST", "直線"]) {
      await expect(labelCell(table, label).locator(".drt-row-note")).toHaveText("1位だけ");
    }
    for (const label of ["展示T", "一周", "まわり足"]) {
      await expect(labelCell(table, label).locator(".drt-row-note")).toHaveCount(0);
    }

    // 位置: 印の付く行（展示T・一周・まわり足）をボタンで切り替え、値の小さい（速い）艇ほど左。同じ値は同じ位置
    const dots = page.getByTestId("rbi-position-dots");
    await expect(dots).toBeVisible();
    await expect(dots).toContainText("左ほど速い");
    const buttons = dots.locator(".rbi-posdots-switch-btn");
    await expect(buttons).toHaveText(["展示T", "一周", "まわり足"]);
    await expect(buttons.first()).toHaveAttribute("aria-pressed", "true");
    for (const label of ["展示T", "一周", "まわり足"]) {
      await buttons.filter({ hasText: new RegExp(`^${label}$`) }).click();
      await expect(buttons.filter({ hasText: new RegExp(`^${label}$`) })).toHaveAttribute("aria-pressed", "true");
      const chips = await dots.locator(".rbi-posdots-chip").evaluateAll((els) =>
        els.map((el) => ({
          value: Number(el.dataset.value),
          center: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2,
          bg: getComputedStyle(el).backgroundColor,
        })),
      );
      expect(chips.length, label).toBeGreaterThanOrEqual(5);
      for (const a of chips) {
        for (const b of chips) {
          if (a.value < b.value) expect(a.center).toBeLessThan(b.center);
          if (a.value === b.value) expect(Math.abs(a.center - b.center)).toBeLessThan(1);
        }
      }
      // 札は艇の色（6艇で違う色）。良し悪しの色（緑・赤）に塗り替えない
      expect(new Set(chips.map((c) => c.bg)).size).toBe(chips.length);
      // 目盛りは値の範囲の中に昇順で2本以上（値を図から読めるように）
      const values = chips.map((c) => c.value);
      const ticks = (await dots.locator(".rbi-posdots-tick").allTextContents()).map(Number);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
      ticks.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(Math.min(...values) - 1e-9);
        expect(v).toBeLessThanOrEqual(Math.max(...values) + 1e-9);
      });
    }
    await expect(page.getByTestId("rbi-tier-legend")).toContainText("「1位だけ」の行");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
