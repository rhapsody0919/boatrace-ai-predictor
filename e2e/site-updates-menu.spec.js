import { test, expect } from "./fixtures.js";
import { SITE_UPDATES } from "../src/data/siteUpdates.js";

// メニューの「更新のお知らせ」と NEW・☰ の点（docs/design/site-updates/ spec R6）。
// 時計を最新の新機能・改善の日の正午（JST）に置くと7日以内なので NEW が出る
const latest = SITE_UPDATES.find((u) => u.kind !== "minor");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${latest.date}T12:00:00+09:00`));
});

test("ja: ☰ に点、メニューに「更新のお知らせ」と NEW、押すと /updates", async ({ page }) => {
  await page.goto("/");
  const menuBtn = page.locator(".menu-btn");
  await expect(menuBtn.locator(".site-updates-menu-dot")).toHaveCount(1);
  await menuBtn.click();
  const item = page.locator(".submenu").getByRole("link", { name: /更新のお知らせ/ });
  await expect(item).toBeVisible();
  await expect(item.locator(".site-updates-menu-new")).toHaveText("NEW");
  await item.click();
  await expect(page).toHaveURL(/\/updates$/);
});

test("en: 点も項目も出さない", async ({ page }) => {
  await page.goto("/en");
  const menuBtn = page.locator(".menu-btn");
  await expect(menuBtn.locator(".site-updates-menu-dot")).toHaveCount(0);
  await menuBtn.click();
  await expect(page.locator(".submenu")).toBeVisible();
  await expect(page.locator(".submenu").getByRole("link", { name: /更新のお知らせ/ })).toHaveCount(0);
});
