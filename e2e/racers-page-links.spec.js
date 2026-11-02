import { test, expect } from "./fixtures.js";

// 3ページ分を固定し、録画日の選手数・支部の人数に依存させない。
const racers = Array.from({ length: 151 }, (_, i) => ({
  racer_id: String(4000 + i), name: `試験選手${i}`, branch: "東京",
  birth_date: "1990-01-01", registration_period: "100期", hometown: "東京都",
  height_cm: 170, weight_kg: 52,
}));

test.beforeEach(async ({ page }) => {
  await page.route("**/rest/v1/racer_profiles?*", (route) =>
    route.fulfill({ json: racers }));
  await page.route("**/rest/v1/racer_grade_cache?*", (route) =>
    route.fulfill({ json: { data: racers.map((r, i) => ({
      racer_id: r.racer_id, grade: "A1", win_rate: 10 - i / 100,
    })) } }));
});

test("ページ番号・前後はURLを持ち、押すと表とURLが替わる", async ({ page }) => {
  await page.goto("/racers");
  const nav = page.getByRole("navigation", { name: "ページ送り" });
  const two = nav.getByText("2", { exact: true });
  await expect(two).toHaveJSProperty("tagName", "A");
  await expect(two).toHaveAttribute("href", "/racers?page=2");
  await expect(nav.getByLabel("次のページ")).toHaveAttribute("href", "/racers?page=2");
  await expect(nav.getByLabel("前のページ")).toHaveJSProperty("tagName", "SPAN");
  await expect(nav.getByLabel("前のページ")).toHaveAttribute("aria-disabled", "true");
  const first = page.locator(".racers-page-table-view tbody tr").first();
  const before = await first.textContent();
  await two.click();
  await expect(page).toHaveURL(/\/racers\?page=2$/);
  await expect(first).not.toHaveText(before);
  await expect(nav.getByLabel("前のページ")).toHaveAttribute("href", "/racers");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.boat-ai.jp/racers?page=2");
});

test("2ページ目の直リンクに固有のcanonicalとtitleがある", async ({ page }) => {
  await page.goto("/racers?page=2");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.boat-ai.jp/racers?page=2");
  await expect(page.locator("title").filter({ hasText: "選手一覧" })).toHaveText("選手一覧（2ページ目）| 龍神レーダー");
});

test("ページ送りは絞り込み・並び順を保ち、canonicalには含めない", async ({ page }) => {
  await page.goto("/racers?branch=東京&page=2&sort=height&dir=asc&grade=A1");
  const next = page.getByLabel("次のページ");
  await expect(next).toHaveJSProperty("tagName", "A");
  const url = new URL(await next.getAttribute("href"), "https://www.boat-ai.jp");
  expect(Object.fromEntries(url.searchParams)).toEqual({ branch: "東京", page: "3", sort: "height", dir: "asc", grade: "A1" });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://www.boat-ai.jp/racers");
});

test("取得失敗は該当なしではなく共通のエラー表示になる", async ({ page }) => {
  await page.route("**/rest/v1/racer_profiles?*", (route) =>
    route.fulfill({ status: 500, json: { message: "test failure" } }));
  await page.goto("/racers");
  await expect(page.locator(".data-fetch-error")).toBeVisible();
  await expect(page.getByText("条件に一致する選手が見つかりません")).toHaveCount(0);
  await expect(page.locator(".data-fetch-error__reload")).toBeVisible();
});
