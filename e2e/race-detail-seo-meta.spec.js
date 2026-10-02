import { test, expect } from "./fixtures.js";

/**
 * レース詳細の title・description（集客レーン、2026-10-02）の固定。
 *
 * - title・description に開催日を入れる。無いと同じ会場・同じR番号の全日付で同じ title になり、
 *   検索結果で重複扱いになる
 * - ja の title・description には「競艇」を入れる（画面に表示されないメタ情報。code-style.md 例外1、暫定措置）
 * - 画面の h1 には「競艇」を出さない
 */

test("レース詳細: title・description に開催日、ja は競艇を含み、h1 には出さない", async ({
  page,
}) => {
  await page.goto("/race/2026-09-21-02-05", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(
    /^戸田競艇 5R AI予想・展開予測（2026年9月21日.*）- 龍神レーダー$/,
  );
  const description = await page
    .locator('meta[name="description"]')
    .last()
    .getAttribute("content");
  expect(description).toMatch(
    /^2026年9月21日.*の戸田競艇（ボートレース戸田）5R/,
  );

  await expect(page.locator("h1").last()).not.toContainText("競艇");
});

test("レース詳細: 同じ会場・同じR番号でも日付が違えば title も違う", async ({
  page,
}) => {
  await page.goto("/race/2026-09-21-02-05", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/2026年9月21日/);
  const first = await page.title();
  await page.goto("/race/2026-09-29-02-05", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/2026年9月29日/);
  const second = await page.title();
  expect(first).toContain("2026年9月21日");
  expect(second).toContain("2026年9月29日");
  expect(first).not.toBe(second);
});
