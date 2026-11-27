import { test, expect } from "./fixtures.js";
import { EDITION } from "../src/data/grandPrixFeature.js";

// トップの「グランプリ特集」の帯（BOA-1724、オーナー承認 2026-11-27）。時計は録画の時刻（fixtures）のまま試す。
// 開催中の日目・終了の境目は e2e/grandprix-countdown.spec.js の純関数の試験が見る
const banner = (page) => page.locator('a[href="/grandprix"].sg-now-banner__link');

test("ja のトップ: 開幕までの日数つきの帯が出て、特集へつながる", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".main-content")).toBeVisible();
  await expect(banner(page)).toContainText(`グランプリ特集（${EDITION.venueName}）`);
  await expect(banner(page)).toContainText(/開幕まで\d+日|\d+日目/);
  await banner(page).click();
  await expect(page).toHaveURL(/\/grandprix$/);
  await expect(page.locator(".gp-head h1")).toBeVisible();
});

test("en のトップには出さない（遷移先が ja 専用）", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator(".main-content")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});
