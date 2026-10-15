import { test, expect } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "./thinking-assist-fixture.js";

/**
 * 選手名から選手ページ（/racer/{登録番号}）へのリンク（BOA-879）。
 * 思考アシスト: 艇の行は深掘りを開くボタンのまま、深掘りの見出しのフルネームをリンクにする（案B、2026-10-15 オーナー決定）
 * 例のレースは 2026-10-06 徳山10R（3号艇 西岡顕心 = 5224）
 */

test.describe("BOA-879: 思考アシストの選手名リンク", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
    await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
    await expect(page.getByRole("tablist", { name: "見方" })).toBeVisible({
      timeout: 20000,
    });
  });

  test("艇の行は深掘りを開くボタンのまま（リンクにしない）", async ({ page }) => {
    const row = page.getByRole("button", { name: /^3号艇 西岡$/ });
    await expect(row).toBeVisible();
    await expect(row.locator("a")).toHaveCount(0);
    await row.click();
    await expect(page.getByRole("region", { name: /3号艇/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/race/${THINKING_ASSIST_RACE}/assist`));
  });

  test("深掘りの見出しのフルネームが選手ページへのリンクになり、押すと移る", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^3号艇 西岡$/ }).click();
    const deep = page.getByRole("region", { name: /3号艇/ });
    const link = deep.getByRole("heading").getByRole("link", { name: /西岡/ });
    await expect(link).toHaveAttribute("href", "/racer/5224");
    await expect(link).toHaveAttribute("translate", "no");
    await link.click();
    await expect(page).toHaveURL(/\/racer\/5224$/);
  });
});
