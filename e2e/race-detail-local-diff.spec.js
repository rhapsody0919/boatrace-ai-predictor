// 出走表（基本情報）の当地勝率の下に、本人の全国勝率との差（「全国+0.28」、色なし）を出す（意味づけ 2026-11-28）。
// 勝率・2連率の「今日の出走者の中の上位N割」は、オーナーとファン役4人が「表には不要」としたので出さない。
import { test, expect } from "./fixtures.js";

const RACE = "/race/2026-09-27-02-11";

const rowOf = (page, label) =>
  page
    .locator(".drt-table tbody tr")
    .filter({ has: page.locator(".drt-label-full", { hasText: new RegExp(`^${label}$`) }) })
    .first();

for (const width of [375, 1440]) {
  test(`当地勝率の下に全国との差、勝率・2連率には位置を出さない ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
    const local = rowOf(page, "当地勝率");
    await expect(local.locator(".drt-local-diff").first()).toBeVisible({ timeout: 30000 });
    // 差は 当地 − 全国（小数2桁）。1号艇の行の値から確かめる
    const cells = await page.evaluate(() => {
      const row = (label) =>
        [...document.querySelectorAll(".drt-table tbody tr")].find(
          (r) => r.querySelector(".drt-label-full")?.textContent === label,
        );
      const cell = (label, i) => row(label).querySelectorAll("td.drt-cell")[i];
      return [0, 1, 2, 3, 4, 5].map((i) => ({
        win: cell("級別・勝率", i).textContent.replace(cell("級別・勝率", i).querySelector(".drt-grade")?.textContent ?? "", ""),
        local: cell("当地勝率", i).textContent,
      }));
    });
    for (const c of cells) {
      const win = Number(c.win.match(/(\d+\.\d{2})/)?.[1]);
      const loc = Number(c.local.match(/^(\d+\.\d{2})/)?.[1]);
      const diff = c.local.match(/全国([+-]?\d+\.\d{2})/)?.[1];
      if (!(loc > 0)) {
        expect(diff, "当地 0.00 は差を出さない").toBeUndefined();
        continue;
      }
      expect(Math.abs(Number(diff) - (loc - win))).toBeLessThanOrEqual(0.011);
    }
    // 色は付けない（差の字は一つの色）
    const colors = await local.locator(".drt-local-diff").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
    expect(colors.length).toBe(1);
    await expect(page.locator(".drt-day-rank")).toHaveCount(0);
    await expect(page.getByTestId("drt-local-diff-note")).toContainText("本人の全国勝率との差");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
