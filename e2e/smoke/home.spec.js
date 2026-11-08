import { test, expect } from "../fixtures.js";
import fs from "node:fs";

test.describe("ホーム・基本ナビゲーション", () => {
  test("トップページが表示され、主要ナビが機能する", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".logo h1")).toHaveText("龍神レーダー");
  });

  test("ThemeToggleでライト/ダークを切替でき、リロード後も永続化される（BOA-201）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
    await page.reload();

    // ThemeToggleは2026-09-08〜ハンバーガーメニュー内に移設（常時表示のnavには
    // 検索・データ分析ツールのみを残し、モバイル幅でのアイコン折り返しを防ぐため）
    await page.click(".menu-btn");
    const toggle = page.locator(".theme-toggle");
    await expect(toggle).toBeVisible();

    await toggle.click();
    const themeAfterClick = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(["light", "dark"]).toContain(themeAfterClick);

    // リロード後もFOUC防止スクリプトにより同じテーマが即座に反映される
    await page.reload();
    const themeAfterReload = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(themeAfterReload).toBe(themeAfterClick);

    // 再クリックで反対のテーマに戻ることを確認（リロードでメニューが閉じるため再度開く）
    await page.click(".menu-btn");
    await page.locator(".theme-toggle").click();
    const themeAfterSecondClick = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(themeAfterSecondClick).not.toBe(themeAfterClick);

    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
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

test.describe("その他の主要ページ", () => {
  test("ブログ一覧が表示される @blog", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.locator(".app-header")).toBeVisible();
  });

  test("ブログ記事の metaTitle・metaDescription は <title>・meta・OGP にだけ使い、h1 は title のまま（「競艇」は画面に出さない） @blog", async ({
    page,
  }) => {
    // 期待値は記事のデータ（src/data/blog-posts）から読む。記事の改稿で題が変わるたびに試験が落ちないように。
    // 題（title）に「競艇」が無く、metaTitle に有る記事で見る。ai-index-reading-guide がそうでなくなったら、
    // ほかの当てはまる記事で見る（試験が黙って空振りしないよう、当てはまる記事が無ければ落とす）
    const postsDir = new URL("../../src/data/blog-posts/", import.meta.url);
    const readPost = (file) =>
      JSON.parse(fs.readFileSync(new URL(file, postsDir), "utf8"));
    const fits = (p) =>
      typeof p.metaTitle === "string" &&
      typeof p.metaDescription === "string" &&
      p.metaTitle.includes("競艇") &&
      !p.title.includes("競艇");
    const preferred = readPost("ai-index-reading-guide.json");
    const post = fits(preferred)
      ? preferred
      : fs
          .readdirSync(postsDir)
          .filter((f) => f.endsWith(".json"))
          .map(readPost)
          .find(fits);
    expect(post, "題に「競艇」が無く metaTitle に有る記事").toBeTruthy();
    const startsWith = (text) =>
      new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

    await page.goto(`/blog/${post.id}`);
    const h1 = page.locator(".blog-post-header h1");
    await expect(h1).toContainText(post.title);
    await expect(page).toHaveTitle(startsWith(post.metaTitle));
    expect(await h1.innerText()).not.toContain("競艇");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      startsWith(post.metaDescription),
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      startsWith(post.metaTitle),
    );
  });

  test("存在しないパスはトップページにリダイレクトされる", async ({ page }) => {
    await page.goto("/this-path-does-not-exist");
    await expect(page).toHaveURL("/");
  });
});

test.describe("titleタグの回帰確認（React 19 head-hoistingは<title>の子要素が複数だと空文字になる）", () => {
  test("ブログ記事詳細ページのtitleが空にならない @blog", async ({ page }) => {
    await page.goto("/blog/rough-race-signals");
    await expect(page).toHaveTitle(/.+\| 龍神レーダー$/);
  });

  test("レース詳細ページのtitleが空にならない", async ({ page }) => {
    await page.goto("/races/2026-06-22");
    await expect(page).toHaveTitle(/.+龍神レーダー$/);
  });
});
