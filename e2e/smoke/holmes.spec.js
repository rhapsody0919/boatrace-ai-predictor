import { test, expect } from "../fixtures.js";

test.describe("ホームズ予想（α版・非公開リンク）", () => {
  test("/holmes のアドラータブで順列確率の実測値が表示される", async ({
    page,
  }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("アドラー")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "アドラー予想",
    );
    // モデルJSON（data/adler/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".adler-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（フィットレース数）が数値で出ている
    await expect(page.locator(".adler-stat-value").nth(3)).not.toHaveText("—");
  });

  test("/holmes のワトソンタブでモデル実測値が表示される", async ({ page }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("ワトソン")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "ワトソン予想",
    );
    // モデルJSON（data/watson/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".watson-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（学習レース数）が数値で出ている
    await expect(page.locator(".watson-stat-value").nth(3)).not.toHaveText("—");
  });

  test("/holmes のマイクロフトタブでモデル実測値が表示される", async ({
    page,
  }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("マイクロフト")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "マイクロフト予想",
    );
    // モデルJSON（data/mycroft/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".mycroft-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（学習レース数）が数値で出ている
    await expect(page.locator(".mycroft-stat-value").nth(3)).not.toHaveText(
      "—",
    );
  });
});
