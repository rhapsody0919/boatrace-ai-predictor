import { test, expect } from "./fixtures.js";

// 更新のお知らせ（/updates、docs/design/site-updates/）。データを足しても落ちないよう、最初の月と件の形だけを見る
test("/updates: 月ごとの一覧・札・畳み・今つくっている物・断り", async ({ page }) => {
  await page.goto("/updates");

  await expect(page).toHaveTitle("更新のお知らせ｜龍神レーダー");
  await expect(page.locator(".site-updates-head h1")).toHaveText("更新のお知らせ");

  const months = page.locator(".site-updates-month-title");
  await expect(months.first()).toHaveText(/^\d{4}年\d{1,2}月$/);

  const first = page.locator(".site-updates-item").first();
  await expect(first.locator(".site-updates-date")).toHaveText(/^\d{2}\/\d{2}$/);
  await expect(first.locator(".site-updates-tag")).toHaveText(/^(新機能|改善)$/);

  // 「見てみる」は ja のパスのまま（言語の接頭辞を付けない）
  const tryLink = page.getByRole("link", { name: "見てみる →" }).first();
  await expect(tryLink).toHaveAttribute("href", /^\/(?!en\/|ko\/|zh-TW\/)/);

  // 細かい改善は畳んであり、開くと行が見える
  const minor = page.locator(".site-updates-minor").first();
  await expect(minor.locator("summary")).toHaveText(/^ほか細かい改善 \d+件$/);
  await expect(minor.locator("li").first()).toBeHidden();
  await minor.locator("summary").click();
  await expect(minor.locator("li").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "今つくっている物" })).toBeVisible();
  await expect(page.locator(".site-updates-disclaimer")).toContainText(
    "日本国内に住む20歳以上",
  );
  await expect(page.locator(".site-updates")).not.toContainText("競艇");
});
