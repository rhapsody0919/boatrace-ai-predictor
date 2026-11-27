// 出走表（基本情報）の全国勝率・2連率の下に、今日出走する選手の中の位置（上位N割・下位N割）、当地勝率の下に全国との差を出す
// （意味づけ、オーナー 2026-11-28 が物差しを「今日の出走者」に決めた）。色は付けない。
import { test, expect } from "./fixtures.js";

const RACE = "/race/2026-09-27-02-11";

const rowOf = (page, label) =>
  page
    .locator(".drt-table tbody tr")
    .filter({ has: page.locator(".drt-label-full", { hasText: new RegExp(`^${label}$`) }) })
    .first();

for (const width of [375, 1440]) {
  test(`全国勝率・2連率に「上位N割・下位N割」、当地勝率に「全国比」 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
    const win = rowOf(page, "級別・勝率");
    await expect(win.locator(".drt-day-rank").first()).toBeVisible({ timeout: 30000 });
    const ranks = await win.locator(".drt-day-rank").allTextContents();
    expect(ranks.length).toBe(6);
    ranks.forEach((r) => expect(r).toMatch(/^(上位|下位)([1-5])割$/));
    // 勝率の高い艇ほど上の段（上位の割が小さい・下位の割が大きい）
    const scored = await win.locator("td.drt-cell").evaluateAll((cells) =>
      cells.map((c) => {
        // 級（A1 等）の札の字を除いて勝率を読む
        const grade = c.querySelector(".drt-grade")?.textContent ?? "";
        const value = Number((c.textContent.replace(grade, "").match(/(\d+\.\d{2})/) ?? [])[1]);
        const r = c.querySelector(".drt-day-rank");
        const n = Number(r.textContent.match(/(\d)割/)[1]);
        // 上位1割 → 1、上位5割 → 5、下位5割 → 6、下位1割 → 10
        return { value, order: r.dataset.side === "top" ? n : 11 - n };
      }),
    );
    for (const a of scored) for (const b of scored) if (a.value > b.value) expect(a.order).toBeLessThanOrEqual(b.order);
    // 色は付けない（文字は灰の副の色で、上位・下位で同じ）
    const colors = await win.locator(".drt-day-rank").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
    expect(colors.length).toBe(1);
    await expect(rowOf(page, "全国2連率").locator(".drt-day-rank")).not.toHaveCount(0);
    await expect(rowOf(page, "当地勝率").locator(".drt-local-diff").first()).toContainText(/^全国比 [+-]?\d+\.\d{2}$/);
    await expect(page.getByTestId("drt-day-rank-note")).toContainText(/今日出走する選手（\d+人）/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
