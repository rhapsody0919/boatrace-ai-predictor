import { test, expect } from "./fixtures.js";
import { SITE_UPDATES } from "../src/data/siteUpdates.js";

// トップの更新のお知らせの帯（docs/design/site-updates/ spec R5）。帯は日付で出入りするので、
// 時計を最新の新機能・改善の日の正午（JST）に置き、データを足しても同じ形で試す
const latest = SITE_UPDATES.find((u) => u.kind !== "minor");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${latest.date}T12:00:00+09:00`));
});

test("ja のトップ: 最新の1件の帯が出て、×で閉じると再読み込みでも出ない", async ({ page }) => {
  await page.goto("/");
  const banner = page.locator(".site-updates-banner");
  await expect(banner).toBeVisible();
  await expect(banner.locator(".site-updates-banner-title")).toHaveText(latest.title);
  await expect(banner.getByRole("link")).toHaveAttribute("href", "/updates");

  await banner.getByRole("button", { name: "このお知らせを閉じる" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".main-content")).toBeVisible();
  await expect(page.locator(".site-updates-banner")).toHaveCount(0);
});

test("en のトップには帯を出さない", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator(".main-content")).toBeVisible();
  await expect(page.locator(".site-updates-banner")).toHaveCount(0);
});
