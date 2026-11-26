// 直前情報の展示の表で、展示タイム・一周・まわり足の行だけに6艇の上位2・下位2の印（▲速い・▼遅い）を付ける
// （見せ方の型2、意味づけ 2026-11-26 オーナー承認）。直線は効き目が確かめられず印なし。
import { test, expect } from "./fixtures.js";

// オリジナル展示（一周・まわり足・直線）がそろう録画のレース（race-detail-wide-screen.spec.js と同じ）
const RACE = "/race/2026-09-29-16-12";

async function rowByLabel(table, label) {
  return table.locator("tbody tr").filter({ has: table.page().locator(".drt-label-cell", { hasText: label }) }).first();
}

async function cellValues(row) {
  const cells = row.locator("td.drt-cell");
  const n = await cells.count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const cell = cells.nth(i);
    const text = (await cell.locator(".drt-value").first().textContent().catch(() => null)) ?? "";
    out.push({
      value: Number.parseFloat(text.replace(/[()]/g, "")),
      cls: (await cell.getAttribute("class")) ?? "",
      // 印は ::after（data-mark）で出す。セルの文字（値）に混ざらないことも確かめる
      text: (await cell.textContent()) ?? "",
      mark: await cell.evaluate((el) => {
        const m = el.querySelector(".drt-tier-mark");
        return m ? getComputedStyle(m, "::after").content : "";
      }),
    });
  }
  return out;
}

for (const width of [375, 1440]) {
  test(`展示タイム・一周・まわり足に上位2・下位2の印、直線は印なし ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: /^直前情報$/ }).click();
    const table = page.locator(".drt-table").first();
    await expect(table.locator("tbody tr")).toHaveCount(15, { timeout: 30000 });
    for (const label of ["展示T", "一周", "まわり足"]) {
      const cells = await cellValues(await rowByLabel(table, label));
      const top = cells.filter((c) => c.cls.includes("drt-tier-top"));
      const bottom = cells.filter((c) => c.cls.includes("drt-tier-bottom"));
      expect(top.length, `${label} の上位`).toBeGreaterThanOrEqual(2);
      expect(bottom.length, `${label} の下位`).toBeGreaterThanOrEqual(2);
      top.forEach((c) => expect(c.mark).toContain("▲速い"));
      bottom.forEach((c) => expect(c.mark).toContain("▼遅い"));
      cells.forEach((c) => expect(c.text).not.toMatch(/[▲▼]/));
      // 上位は印の無い艇より速く（小さく）、下位は遅い
      const others = cells.filter((c) => !c.cls.includes("drt-tier-") && Number.isFinite(c.value));
      for (const o of others) {
        top.forEach((c) => expect(c.value).toBeLessThanOrEqual(o.value));
        bottom.forEach((c) => expect(c.value).toBeGreaterThanOrEqual(o.value));
      }
    }
    // 印の色は意味トークン（緑・赤）で、印の無いセルの字の色と違う
    const exRow = await rowByLabel(table, "展示T");
    const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
    const plainColor = await colorOf(exRow.locator("td.drt-cell:not([class*='drt-tier-']) .drt-value").first());
    expect(await colorOf(exRow.locator("td.drt-tier-top .drt-tier-mark").first())).not.toBe(plainColor);
    expect(await colorOf(exRow.locator("td.drt-tier-bottom .drt-tier-mark").first())).not.toBe(plainColor);
    const straight = await cellValues(await rowByLabel(table, "直線"));
    expect(straight.some((c) => c.cls.includes("drt-tier-"))).toBe(false);
    await expect(page.getByTestId("rbi-tier-legend")).toContainText("当社の過去データで確かめた行");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
