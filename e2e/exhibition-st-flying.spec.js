import { test, expect } from "./fixtures.js";

/**
 * 展示STのフライング・出遅れ（BOA-759）。DB の start_timing は印を外した正の数（F.01→0.01）で、
 * 印（exhibition_data.start_flag）を読んでいなかったため、F の艇が「0.01」と一番早く見え、
 * 「最良」の金枠が付いていた。公式の表記（F.01）で出し、最良の候補から外す。
 */

// 2026-10-04 浜名湖12R: 4号艇が展示で F.01（公式の直前情報）
const RACE = "2026-10-04-06-12";
const F_BOAT = 4;

test("直前情報の展示STは、展示でフライングした艇を F.01 と書き、最良の金枠を付けない", async ({
  page,
}) => {
  test.slow();
  await page.goto(`/race/${RACE}`, { waitUntil: "domcontentloaded" });
  await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
  const row = page
    .locator(".drt-table tbody tr")
    .filter({ has: page.locator(".drt-label-full", { hasText: /^展示ST$/ }) });
  await expect(row).toHaveCount(1, { timeout: 60000 });
  const cell = row.locator("td.drt-cell").nth(F_BOAT - 1);
  await expect(cell).toHaveText("F.01", { timeout: 60000 });
  await expect(cell).not.toHaveClass(/drt-best/);
  await expect(cell.locator("[title]")).toHaveAttribute("title", /フライング/);
  // 金枠は、印の無い艇のどれかに付いている
  const bestCells = row.locator("td.drt-best");
  await expect(bestCells).not.toHaveCount(0);
  for (const text of await bestCells.allTextContents()) {
    expect(text).toMatch(/^\d\.\d{2}$/);
  }
});

test("展示STの表記: 印があれば公式どおり F.01・L、無ければ値だけ", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(async () => {
    const { formatExhibitionSt } = await import("/src/utils/formatters.js");
    return [
      formatExhibitionSt(0.01, "F"),
      formatExhibitionSt(0.05, "L"),
      formatExhibitionSt(null, "L"),
      formatExhibitionSt(0.13, null),
      formatExhibitionSt(null, null),
    ];
  });
  expect(out).toEqual(["F.01", "L.05", "L", "0.13", null]);
});
