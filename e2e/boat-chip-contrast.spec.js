import { test, expect } from "./fixtures.js";

const backgrounds = {
  1: "rgb(255, 255, 255)",
  2: "rgb(0, 0, 0)",
  3: "rgb(198, 40, 40)",
  4: "rgb(21, 101, 192)",
  5: "rgb(253, 216, 53)",
  6: "rgb(46, 125, 50)",
};

async function checkChips(page, selector) {
  for (const [number, background] of Object.entries(backgrounds)) {
    const chips = page.locator(selector).filter({ hasText: new RegExp(`^${number}$`) });
    await expect(chips.first()).toBeVisible();
    for (const chip of await chips.all()) {
      await expect(chip).toHaveCSS("background-color", background);
      await expect(chip).toHaveCSS("color", ["1", "5"].includes(number)
        ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
    }
  }
}

for (const theme of ["light", "dark"]) {
  test(`${theme}: 今節の艇番印は白文字用の濃い地を使う`, async ({ page }) => {
    await page.goto("/race/2026-09-21-09-02");
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-compare tbody tr").first()).toBeVisible();
    await checkChips(page, ".rmt-compare .rmt-boat-chip");
    await checkChips(page, ".rmt-boat-chip");
  });

  test(`${theme}: 結果の艇番印は濃い地、直前情報の見出しは公式色`, async ({ page }) => {
    await page.goto("/race/2026-09-19-02-09");
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await page.locator(".race-tabs-btn", { hasText: /^結果$/ }).click();
    await checkChips(page, ".rr-boat-chip");
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    await expect(page.locator(".drt-boat-th").filter({ hasText: /^3/ }).first())
      .toHaveCSS("background-color", "rgb(229, 57, 53)");
  });
}
