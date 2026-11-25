import { test, expect } from "./fixtures.js";
import {
  button,
  panel,
  captureFeedbackPosts,
} from "./site-feedback-helpers.js";

/**
 * ご意見ボックスで「データの誤り」を選んだときだけ、どのレースのどの数字かを書く案内を出す
 * （送るのはページの種類だけで、レースの番号は送らない。オーナー 2026-11-25、ファン評価の P2）。
 */
test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("「データの誤り」を選ぶと案内が出て、外すかほかの種類に替えると消える。案内は送らない", async ({
    page,
  }) => {
    const rows = await captureFeedbackPosts(page);
    await page.goto("/");
    await button(page).click();
    const hint = page.getByTestId("site-feedback-data-hint");
    await expect(hint).toHaveCount(0);
    await panel(page).getByText("データの誤り", { exact: true }).click();
    await expect(hint).toHaveText(/どのレースの、どの数字か/);
    await panel(page).getByText("その他", { exact: true }).click();
    await expect(hint).toHaveCount(0);
    await panel(page).getByText("データの誤り", { exact: true }).click();
    await expect(hint).toBeVisible();
    // もう一度押すと外れ、案内も消える
    await panel(page).getByText("データの誤り", { exact: true }).click();
    await expect(hint).toHaveCount(0);
    await panel(page).getByText("データの誤り", { exact: true }).click();
    await panel(page)
      .locator("textarea")
      .fill("桐生 11/23 3R の2号艇のモーター2連率が公式と違う");
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "data", page_type: "home" });
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["client_key", "comment", "kind", "lang", "page_type", "rating"].sort(),
    );
  });

  test("英語のページでは英語の案内が出る", async ({ page }) => {
    await page.goto("/en/");
    await button(page).click();
    await panel(page).getByText("Wrong data", { exact: true }).click();
    await expect(page.getByTestId("site-feedback-data-hint")).toHaveText(
      /which race and which number/,
    );
  });
});
