// モータ情報の一覧で、公式のモーター2連率に6艇の上位2・下位2の印（▲高い・▼低い）を付ける
// （見せ方の型2、意味づけ 2026-11-26 オーナー承認。順位の効き目は docs/knowledge/stat-findings.md 7行）。
import { test, expect } from "./fixtures.js";

// 録画のあるレース（直前情報の印の試験と同じ）
const RACE = "/race/2026-09-29-16-12";

test.describe.configure({ timeout: 150000 });

for (const width of [375, 1440]) {
  test(`公式2連率の上位2に▲高い・下位2に▼低い ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const table = page.locator(".mcc-list-table").first();
    await expect(table).toBeVisible({ timeout: 90000 });
    const cells = table.locator("tbody tr .motor-rate-bar-cell");
    await expect(cells).toHaveCount(6);
    const rows = await cells.evaluateAll((els) =>
      els.map((el) => ({
        value: Number((el.textContent.match(/([\d.]+)%/) ?? [])[1]),
        tier: el.querySelector(".motor-tier-mark")?.dataset.tier ?? null,
        mark: el.querySelector(".motor-tier-mark")?.textContent ?? "",
      })),
    );
    const top = rows.filter((r) => r.tier === "top");
    const bottom = rows.filter((r) => r.tier === "bottom");
    expect(top.length).toBeGreaterThanOrEqual(2);
    expect(bottom.length).toBeGreaterThanOrEqual(2);
    top.forEach((r) => expect(r.mark).toBe("▲高い"));
    bottom.forEach((r) => expect(r.mark).toBe("▼低い"));
    // 上位は印の無い艇より高く、下位は低い
    const others = rows.filter((r) => r.tier === null && Number.isFinite(r.value));
    for (const o of others) {
      top.forEach((r) => expect(r.value).toBeGreaterThanOrEqual(o.value));
      bottom.forEach((r) => expect(r.value).toBeLessThanOrEqual(o.value));
    }
    // 印の色は緑・赤（意味トークン）で互いに違う
    const colorOf = (tier) =>
      table.locator(`.motor-tier-mark[data-tier="${tier}"]`).first().evaluate((el) => getComputedStyle(el).color);
    expect(await colorOf("top")).not.toBe(await colorOf("bottom"));
    await expect(page.getByTestId("motor-tier-note")).toContainText("当社の過去データで確かめています");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
