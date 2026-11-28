// モータ情報の一覧で、公式のモーター2連率の棒の下に、他の艇の平均との符号つきの差と順位（「+10.2・1位」）を出す
// （plan.md §14、オーナー 2026-11-28。旧: 意味づけ 2026-11-26 の ▲高い・▼低い。順位の効き目は docs/knowledge/stat-findings.md 7行）。
// 試験名は変異検査（試験名で旧と新を対応させる）のため旧のまま
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
    // ▲▼ の代わりに、他の艇の平均との符号つきの差と順位（plan.md §14、オーナー 2026-11-28）。色は付けない
    const rows = await cells.evaluateAll((els) =>
      els.map((el) => ({
        value: Number((el.textContent.match(/([\d.]+)%/) ?? [])[1]),
        gap: el.querySelector(".motor-rate-gap")?.textContent ?? null,
        rank: Number(el.querySelector(".motor-rate-gap")?.dataset.rank ?? NaN),
        mark: el.querySelector(".motor-tier-mark") !== null,
      })),
    );
    expect(rows.some((r) => r.mark)).toBe(false);
    const valued = rows.filter((r) => r.gap !== null);
    expect(valued.length).toBeGreaterThanOrEqual(2);
    for (const r of valued) {
      expect(r.gap).toMatch(/^(?:[+−]\d+\.\d|±0\.0)・\d位$/);
      // 順位は自分より高い値の艇の数＋1
      expect(r.rank).toBe(1 + valued.filter((o) => o.value > r.value).length);
      // 差の符号は他の艇の平均との上下と合う
      const others = valued.filter((o) => o !== r);
      const mean = others.reduce((a, o) => a + o.value, 0) / others.length;
      if (Math.abs(r.value - mean) >= 0.05) expect(r.gap.startsWith(r.value > mean ? "+" : "−")).toBe(true);
    }
    // 読み方は見出しの「?」の中。表の下の ▲▼ の注記は出さない
    await expect(page.getByTestId("motor-tier-note")).toHaveCount(0);
    await expect(table.locator("thead .term-hint__button")).toHaveCount(1);
    await table.locator("thead .term-hint__button").first().click();
    await expect(page.locator(".term-hint__popover")).toContainText("当社の過去データで確かめています");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
