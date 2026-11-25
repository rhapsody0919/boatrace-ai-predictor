// モータ情報タブの PC の並び（src/components/race/RaceTabs.css の末尾「モータ情報の PC の並び」）。
// 1200px 以上: 表は全幅、表の下の注記は2列（高さはそろえない）。押して出る部品の名前は全幅。
// 1199px 以下と分析ページ（/winning-technique）は今の縦並びのまま
import { test, expect } from "../fixtures.js";

const PATH = "/race/2026-09-29-16-12?tab=motor";
const BOX = ".race-tabs-panel > .motor-condition-container";
const NOTES = `${BOX} > .table-wrapper ~ .table-note`;

async function openMotor(page) {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".motor-ranking-table")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(NOTES).first()).toBeVisible({ timeout: 30000 });
}

const lefts = (page, selector) =>
  page
    .locator(selector)
    .evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().left)));

const edgesOf = (page, selector) =>
  page.locator(selector).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });

test.describe("レイアウト: モータ情報の PC の並び", () => {
  test("1200px 以上は表の下の注記が2列で、表は全幅、横にはみ出さない", async ({ page }) => {
    test.skip(page.viewportSize().width < 1200, "1200px 以上だけの並び");
    await openMotor(page);
    const box = await page.locator(BOX).evaluate((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return {
        left: r.left + parseFloat(s.paddingLeft),
        right: r.right - parseFloat(s.paddingRight),
      };
    });
    const table = await edgesOf(page, `${BOX} > .table-wrapper`);
    expect(Math.abs(table.left - box.left), "表の左端").toBeLessThan(2);
    expect(Math.abs(table.right - box.right), "表の右端").toBeLessThan(2);

    const xs = await lefts(page, NOTES);
    expect(xs.length, "表の下の注記の数").toBeGreaterThanOrEqual(2);
    expect(new Set(xs).size, "注記の列の数").toBe(2);
    await expect(page.locator(BOX)).toHaveCSS("align-items", "start");

    // 部品の交換があれば押して、部品の名前が表のすぐ下に全幅で出ることを見る
    const badge = page.locator(".mcc-parts-badge").filter({ hasNotText: "交換0" }).first();
    if ((await badge.count()) > 0) {
      await badge.click();
      await expect(page.locator(".mcc-parts-names")).toBeVisible();
      const names = await edgesOf(page, ".mcc-parts-names");
      expect(Math.abs(names.left - box.left), "部品の名前の左端").toBeLessThan(2);
      expect(Math.abs(names.right - box.right), "部品の名前の右端").toBeLessThan(2);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "横スクロール").toBe(0);
  });

  test("1199px 以下は注記を縦に積む", async ({ page }) => {
    test.skip(page.viewportSize().width >= 1200, "1199px 以下だけの並び");
    await openMotor(page);
    expect(new Set(await lefts(page, NOTES)).size, "注記の列の数").toBe(1);
  });

  test("分析ページのモーターの容器は 1200px 以上でも並べ替えない", async ({ page }) => {
    test.skip(page.viewportSize().width < 1200, "1200px 以上だけの確かめ");
    await page.goto("/winning-technique?tab=motor&venue_code=16", {
      waitUntil: "domcontentloaded",
    });
    const container = page.locator(".motor-condition-container").first();
    await expect(container).toBeVisible({ timeout: 30000 });
    await expect(container).not.toHaveCSS("display", "grid");
  });
});
