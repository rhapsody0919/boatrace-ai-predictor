import { test, expect } from "./fixtures.js";
import { BLOG_PATH, button } from "./site-feedback-helpers.js";

/**
 * 768px 以下では、どの画面でも下へ読み進めている間はご意見ボックスのボタンを隠し、上へ戻すと出す
 * （本文・成績表の右端を隠さない。オーナー 2026-11-25、ファン評価の P2）。広い幅はアイコンだけに縮むまま。
 */
for (const [label, viewport] of [
  ["スマホの幅（375px）", { width: 375, height: 812 }],
  ["タブレットの幅（768px）", { width: 768, height: 1024 }],
]) {
  test.describe(label, () => {
    test.use({ viewport });

    for (const path of ["/", BLOG_PATH]) {
      test(`${path} で下へ読むと隠れ、上へ戻すと出る${path === BLOG_PATH ? " @blog" : ""}`, async ({
        page,
      }) => {
        await page.goto(path);
        await expect(button(page)).toBeVisible({ timeout: 25000 });
        await page.mouse.wheel(0, 600);
        await expect(button(page)).toHaveClass(/is-mini/);
        await expect(button(page)).toBeHidden();
        await page.mouse.wheel(0, -300);
        await expect(button(page)).toBeVisible();
      });
    }
  });
}

test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("下へ読んでも隠さず、アイコンだけに縮む @blog", async ({ page }) => {
    await page.goto(BLOG_PATH);
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await page.mouse.wheel(0, 600);
    await expect(button(page)).toHaveClass(/is-mini/);
    await expect(button(page)).toBeVisible();
  });
});
