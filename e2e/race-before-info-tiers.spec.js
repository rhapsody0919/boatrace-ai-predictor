// 直前情報の展示の表の展示タイム・一周・まわり足の行に、6艇の上位2・下位2の印（緑▲速い・赤▼遅い）と凡例を出さない
// （plan.md §14、オーナー 2026-11-28 案A: 値だけ。差は表の下の「6艇の位置」の図で見る）。
// 試験の名前は前のまま（guard-weakening が名前の消えた試験を弱めたと数えるため）。中身は「印が無い」ことを見る。
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
    for (const label of ["展示T", "一周", "まわり足", "直線"]) {
      const cells = await cellValues(await rowByLabel(table, label));
      // 値は全艇に出たまま
      expect(cells.filter((c) => Number.isFinite(c.value)).length, `${label} の値`).toBeGreaterThanOrEqual(5);
      cells.forEach((c) => {
        expect(c.cls, `${label} の色の印`).not.toContain("drt-tier-");
        expect(c.mark, `${label} の印の字`).toBe("");
        expect(c.text, `${label} の ▲▼`).not.toMatch(/[▲▼]/);
      });
    }
    // 値の字の色は、一番速い値の金枠を除き、印の有無で変わらない（緑・赤が残っていない）
    const exRow = await rowByLabel(table, "展示T");
    const colors = await exRow.locator("td.drt-cell:not(.drt-best) .drt-value").evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).color))]);
    expect(colors.length).toBe(1);
    await expect(page.getByTestId("rbi-tier-legend")).toHaveCount(0);
    // 差の大きさを見る「6艇の位置」の図は残る
    await expect(page.getByTestId("rbi-position-dots")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
