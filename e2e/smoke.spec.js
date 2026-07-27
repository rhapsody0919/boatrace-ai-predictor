import { test, expect } from "@playwright/test";

test.describe("ホーム・基本ナビゲーション", () => {
  test("トップページが表示され、主要ナビが機能する", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".logo h1")).toHaveText("BoatAI");
  });

  test("日本語(ja)のハンバーガーメニューには会場ガイドが表示されない", async ({
    page,
  }) => {
    await page.goto("/");
    await page.click(".menu-btn");
    await expect(page.locator(".submenu")).toBeVisible();
    await expect(
      page.locator('a.submenu-item:has-text("会場ガイド")'),
    ).toHaveCount(0);
  });
});

test.describe("会場ガイド (venues)", () => {
  test("/en のハンバーガーメニューから会場ガイドへ遷移できる", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.click(".menu-btn");
    const venuesLink = page.locator('a.submenu-item:has-text("Venue Guides")');
    await expect(venuesLink).toBeVisible();
    await expect(venuesLink).toHaveAttribute("href", "/en/venues");
    await venuesLink.click();
    await expect(page).toHaveURL(/\/en\/venues$/);
  });

  test("/en/venues に会場カードが表示される", async ({ page }) => {
    await page.goto("/en/venues");
    const cards = page.locator(".evg-card");
    await expect(cards.first()).toBeVisible();
  });

  test("会場詳細ページ(/en/venues/heiwajima)が表示される", async ({ page }) => {
    await page.goto("/en/venues/heiwajima");
    await expect(
      page.getByRole("heading", { name: /Heiwajima/i }),
    ).toBeVisible();
  });
});

test.describe("言語切替 (回帰: 対応外言語クリックでホームに飛ばされない)", () => {
  test("/en/venues で対応外言語(韓国語)ボタンは無効化され、クリックしても遷移しない", async ({
    page,
  }) => {
    await page.goto("/en/venues");
    const koBtn = page.locator('.language-switcher-btn:has-text("한국어")');
    await expect(koBtn).toBeVisible();
    await expect(koBtn).toHaveAttribute("aria-disabled", "true");
    await expect(koBtn).toHaveClass(/unavailable/);
    // aria-disabled はネイティブ disabled と異なりクリック自体は可能なため force で実クリックを再現
    await koBtn.click({ force: true });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/en\/venues$/);
  });

  test("/en/venues で対応言語(繁體中文)ボタンは正しく遷移する", async ({
    page,
  }) => {
    await page.goto("/en/venues");
    const zhBtn = page.locator('.language-switcher-btn:has-text("中文")');
    await zhBtn.click();
    await expect(page).toHaveURL(/\/zh-TW\/venues$/);
  });
});

test.describe("その他の主要ページ", () => {
  test("ブログ一覧が表示される", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.locator(".app-header")).toBeVisible();
  });

  test("存在しないパスはトップページにリダイレクトされる", async ({ page }) => {
    await page.goto("/this-path-does-not-exist");
    await expect(page).toHaveURL("/");
  });
});
